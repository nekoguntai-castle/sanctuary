import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoinApi from '../../../src/api/bitcoin';
import { getDrafts } from '../../../src/api/drafts';
import type { Wallet } from '../../../src/api/wallets';
import {
  checkBitcoinConnection,
  syncDraftNotifications,
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

const user = { id: 'user-1', isAdmin: false };

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

describe('useLayoutNotifications draft sync ownership', () => {
  const walletA = { id: 'wallet-a', name: 'Alice Vault' } as Wallet;
  const walletB = { id: 'wallet-b', name: 'Alice Spend' } as Wallet;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDrafts).mockReset();
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ connected: true });
  });

  it('stops draft sync and ignores late responses when user logs out or unmounts mid-loop', async () => {
    const actions = createActions();
    let resolveFirstWallet!: (drafts: Array<{ id: string }>) => void;
    vi.mocked(getDrafts).mockImplementation(() => new Promise(resolve => {
      resolveFirstWallet = (drafts) => resolve(drafts as never);
    }));

    const view = renderHook(
      ({ currentUser, currentWallets }) => useLayoutNotifications({
        user: currentUser,
        wallets: currentWallets,
        selectedNetwork: 'mainnet',
        notificationActions: actions,
      }),
      { initialProps: { currentUser: user as { id: string; isAdmin?: boolean } | null, currentWallets: [walletA, walletB] } },
    );

    expect(getDrafts).toHaveBeenCalledTimes(1);
    expect(getDrafts).toHaveBeenCalledWith('wallet-a');

    // User logs out before wallet-a drafts resolve
    view.rerender({ currentUser: null, currentWallets: [] });

    await act(async () => {
      resolveFirstWallet([{ id: 'draft-1' }]);
    });

    expect(actions.addNotification).not.toHaveBeenCalled();
    expect(actions.removeNotificationsByType).not.toHaveBeenCalled();
    // Never moved on to wallet-b
    expect(getDrafts).toHaveBeenCalledTimes(1);
  });

  it('ignores draft fetch errors after unmount or superseding wallets update', async () => {
    const actions = createActions();
    let rejectFirst!: (error: Error) => void;
    vi.mocked(getDrafts).mockImplementationOnce(() => new Promise((_, reject) => {
      rejectFirst = reject;
    }));

    const view = renderHook(() => useLayoutNotifications({
      user,
      wallets: [walletA, walletB],
      selectedNetwork: 'mainnet',
      notificationActions: actions,
    }));

    view.unmount();

    await act(async () => {
      rejectFirst(new Error('network cancelled'));
    });

    expect(getDrafts).toHaveBeenCalledTimes(1);
    expect(actions.addNotification).not.toHaveBeenCalled();
  });

  it('preserves exported syncDraftNotifications default behavior when current', async () => {
    const actions = createActions();
    vi.mocked(getDrafts)
      .mockResolvedValueOnce([{ id: 'd1' }, { id: 'd2' }] as never)
      .mockResolvedValueOnce([]);

    await syncDraftNotifications([walletA, walletB], actions);

    expect(actions.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'pending_drafts',
      scopeId: 'wallet-a',
      title: '2 pending drafts',
      message: 'Alice Vault: Resume or broadcast',
    }));
    expect(actions.removeNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-b');
  });

  it('skips remaining wallets in syncDraftNotifications when isCurrent turns false between iterations', async () => {
    const actions = createActions();
    let current = true;
    vi.mocked(getDrafts).mockImplementationOnce(async () => {
      current = false;
      return [{ id: 'd1' }] as never;
    });

    await syncDraftNotifications([walletA, walletB], actions, () => current);

    expect(getDrafts).toHaveBeenCalledTimes(1);
    expect(actions.addNotification).not.toHaveBeenCalled();
  });
});
