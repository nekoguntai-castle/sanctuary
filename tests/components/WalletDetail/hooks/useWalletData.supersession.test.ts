/**
 * Non-regression tests for the `fetchDataWithResult` tri-state contract.
 *
 * Bug: `fetchDataWithResult` used to return a plain `boolean`, collapsing
 * "a newer request superseded this one" (an expected, benign race) into the
 * same `false` as "the fetch genuinely failed". `refreshSyncStatus` in
 * `useWalletDetailController.ts` threw on any `false`, so a merely
 * superseded refresh surfaced as a "Sync Status Not Refreshed" warning.
 *
 * Fix: `fetchDataWithResult` (surfaced here through `refreshData`) now
 * resolves `'ok' | 'superseded' | 'failed'`, and only `'failed'` is treated
 * as an error by callers.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletData } from '../../../../src/components/WalletDetail/hooks/useWalletData';
import { useWalletSharing } from '../../../../src/components/WalletDetail/hooks/useWalletSharing';
import { useAppNotifications } from '../../../../src/contexts/AppNotificationContext';
import { useErrorHandler } from '../../../../src/hooks/useErrorHandler';
import * as adminApi from '../../../../src/api/admin';
import * as authApi from '../../../../src/api/auth';
import * as bitcoinApi from '../../../../src/api/bitcoin';
import * as devicesApi from '../../../../src/api/devices';
import * as draftsApi from '../../../../src/api/drafts';
import * as transactionsApi from '../../../../src/api/transactions';
import * as walletsApi from '../../../../src/api/wallets';
import type { Wallet } from '../../../../src/types';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../src/utils/errorHandler', () => ({
  logError: vi.fn(),
}));

vi.mock('../../../../src/hooks/useErrorHandler', () => ({
  useErrorHandler: vi.fn(),
}));

vi.mock('../../../../src/contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../../../src/components/WalletDetail/mappers', () => ({
  formatApiTransaction: vi.fn((tx: any, walletId: string) => ({
    id: tx.id || tx.txid || 'tx-id',
    walletId,
    txid: tx.txid || tx.id || 'txid',
    amount: tx.amount || 0,
  })),
  formatApiUtxo: vi.fn((utxo: any) => ({
    id: utxo.id || `${utxo.txid || 'tx'}:${utxo.vout || 0}`,
    txid: utxo.txid || 'tx',
    vout: utxo.vout || 0,
    value: utxo.value || utxo.amount || 0,
    address: utxo.address || 'bc1q',
  })),
}));

vi.mock('../../../../src/api/wallets', () => ({
  getWallet: vi.fn(),
  getWalletShareInfo: vi.fn(),
  shareWalletWithUser: vi.fn(),
  shareWalletWithGroup: vi.fn(),
  removeUserFromWallet: vi.fn(),
}));

vi.mock('../../../../src/api/transactions', () => ({
  getTransactions: vi.fn(),
  getTransactionStats: vi.fn(),
  getUTXOs: vi.fn(),
  getWalletPrivacy: vi.fn(),
  getAddresses: vi.fn(),
  getAddressSummary: vi.fn(),
}));

vi.mock('../../../../src/api/devices', () => ({
  getDevices: vi.fn(),
  shareDeviceWithUser: vi.fn(),
}));

vi.mock('../../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

vi.mock('../../../../src/api/auth', () => ({
  getUserGroups: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock('../../../../src/api/admin', () => ({
  getGroups: vi.fn(),
}));

const baseWallet: Wallet = {
  id: 'wallet-1',
  name: 'Primary',
  type: 'multi_sig',
  network: 'mainnet',
  balance: 123456,
  scriptType: 'wsh' as Wallet['scriptType'],
  descriptor: "wsh(sortedmulti(2,[aabbccdd/48'/0'/0'/2']xpub...))",
  fingerprint: 'aabbccdd',
  quorum: 2,
  totalSigners: 3,
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
  lastSyncStatus: 'success',
  syncInProgress: false,
  isShared: true,
  sharedWith: { userCount: 0 },
  userRole: 'owner',
  canEdit: true,
};

const makeTx = (id: string) => ({ id, txid: id, amount: 1000 });
const makeUtxo = (id: string) => ({ id, txid: id, vout: 0, value: 1000, address: 'bc1qtest' });
const makeAddress = (id: string) => ({
  id,
  address: `bc1q${id}`,
  derivationPath: "m/84'/0'/0'/0/0",
  index: 0,
  used: false,
  balance: 0,
  isChange: false,
  labels: [],
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const defaultUser = { id: 'user-1', isAdmin: true } as any;

describe('useWalletData fetchDataWithResult supersession contract', () => {
  const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError: vi.fn() } as never);
    vi.mocked(useAppNotifications).mockReturnValue({
      addNotification: vi.fn(),
      removeNotificationsByType: vi.fn(),
    } as never);

    vi.mocked(walletsApi.getWallet).mockResolvedValue(baseWallet as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ users: [], group: null } as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({ devicesToShare: [] } as never);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: 'https://mempool.space' } as never);

    vi.mocked(devicesApi.getDevices).mockResolvedValue([] as never);

    vi.mocked(transactionsApi.getTransactions).mockResolvedValue(Array.from({ length: 5 }, (_, i) => makeTx(`tx-${i}`)) as never);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValue({ count: 5 } as never);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      count: 3,
      totalBalance: 5000,
      utxos: Array.from({ length: 3 }, (_, i) => makeUtxo(`u-${i}`)),
    } as never);
    vi.mocked(transactionsApi.getWalletPrivacy).mockResolvedValue({
      utxos: [],
      summary: { score: 70 },
    } as never);
    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValue({ totalAddresses: 1 } as never);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([makeAddress('a-1')] as never);

    vi.mocked(draftsApi.getDrafts).mockResolvedValue([] as never);
    vi.mocked(adminApi.getGroups).mockResolvedValue([] as never);
    vi.mocked(authApi.getUserGroups).mockResolvedValue([] as never);
  });

  it('reports missing and stale-route share refreshes as superseded without API work', async () => {
    const missing = renderHook(() => useWalletData({ id: undefined, user: defaultUser }));
    await act(async () => {
      await expect(missing.result.current.refreshWalletShareInfo()).resolves.toEqual({
        status: 'superseded',
      });
    });
    missing.unmount();

    const routed = renderHook(({ id }) => useWalletData({ id, user: defaultUser }), {
      initialProps: { id: 'wallet-1' as string | undefined },
    });
    await waitFor(() => expect(routed.result.current.loading).toBe(false));
    const staleRefresh = routed.result.current.refreshWalletShareInfo;
    act(() => routed.rerender({ id: 'wallet-2' }));
    await act(async () => {
      await expect(staleRefresh()).resolves.toEqual({ status: 'superseded' });
    });
    routed.unmount();
  });

  afterEach(() => {
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
  });

  it('resolves "ok" on the happy path', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let outcome!: Awaited<ReturnType<typeof result.current.refreshData>>;
    await act(async () => {
      outcome = await result.current.refreshData();
    });

    expect(outcome).toBe('ok');
  });

  it('resolves "failed" on a genuine rejection', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(walletsApi.getWallet).mockRejectedValueOnce(new Error('network blew up'));

    let outcome!: Awaited<ReturnType<typeof result.current.refreshData>>;
    await act(async () => {
      outcome = await result.current.refreshData();
    });

    expect(outcome).toBe('failed');
    expect(result.current.error).toBe('Failed to load wallet');
  });

  it('resolves "superseded" — not "failed" — when a second refresh takes ownership mid-fetch', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const staleFetch = createDeferred<typeof baseWallet>();
    vi.mocked(walletsApi.getWallet)
      .mockReturnValueOnce(staleFetch.promise as ReturnType<typeof walletsApi.getWallet>)
      .mockResolvedValueOnce(baseWallet as never);

    const callsBeforeRefresh = vi.mocked(walletsApi.getWallet).mock.calls.length;
    let stalePromise!: Promise<Awaited<ReturnType<typeof result.current.refreshData>>>;
    act(() => {
      stalePromise = result.current.refreshData();
    });
    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledTimes(callsBeforeRefresh + 1));

    // A second refresh takes ownership of the fetch before the first settles.
    let freshPromise!: Promise<Awaited<ReturnType<typeof result.current.refreshData>>>;
    act(() => {
      freshPromise = result.current.refreshData();
    });
    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledTimes(callsBeforeRefresh + 2));

    const freshOutcome = await act(async () => freshPromise);
    expect(freshOutcome).toBe('ok');

    let staleOutcome!: Awaited<ReturnType<typeof result.current.refreshData>>;
    await act(async () => {
      staleFetch.resolve({ ...baseWallet, name: 'Stale' });
      staleOutcome = await stalePromise;
    });

    expect(staleOutcome).toBe('superseded');
    // The superseded fetch must not have overwritten anything or raised an error.
    expect(result.current.error).toBeNull();
  });

  it('keeps a completed sharing refresh when the same-route initial share read resolves last', async () => {
    const initialShare = createDeferred<Awaited<ReturnType<typeof walletsApi.getWalletShareInfo>>>();
    const currentShare = {
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    };
    vi.mocked(walletsApi.getWalletShareInfo)
      .mockReturnValueOnce(initialShare.promise)
      .mockResolvedValueOnce(currentShare as never);
    vi.mocked(walletsApi.shareWalletWithUser).mockResolvedValue({
      devicesToShare: [{ id: 'device-1', label: 'Ledger' }],
    } as never);

    const { result } = renderHook(() => {
      const data = useWalletData({ id: 'wallet-1', user: defaultUser });
      const sharing = useWalletSharing({
        walletId: 'wallet-1',
        wallet: data.wallet,
        devices: data.devices,
        walletShareInfo: data.walletShareInfo,
        groups: data.groups,
        refreshWalletShareInfo: data.refreshWalletShareInfo,
        setWallet: data.setWallet,
      });
      return { data, sharing };
    });

    await waitFor(() => expect(walletsApi.getWalletShareInfo).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.sharing.handleShareWithUser('user-2');
    });
    expect(result.current.data.walletShareInfo).toEqual(currentShare);
    expect(result.current.sharing.deviceSharePrompt.targetUsername).toBe('alice');

    await act(async () => {
      initialShare.resolve({
        users: [{ id: 'user-old', username: 'stale' }],
        group: { id: 'group-old', name: 'Old group' },
      } as never);
      await initialShare.promise;
    });

    expect(result.current.data.walletShareInfo).toEqual(currentShare);
  });

  it('ignores a rejected initial share read after a newer sharing refresh commits', async () => {
    const initialShare = createDeferred<Awaited<ReturnType<typeof walletsApi.getWalletShareInfo>>>();
    const currentShare = {
      users: [{ id: 'user-2', username: 'alice' }],
      group: null,
    };
    vi.mocked(walletsApi.getWalletShareInfo)
      .mockReturnValueOnce(initialShare.promise)
      .mockResolvedValueOnce(currentShare as never);

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(walletsApi.getWalletShareInfo).toHaveBeenCalledTimes(1));

    await act(async () => {
      expect(await result.current.refreshWalletShareInfo()).toEqual({
        status: 'committed',
        shareInfo: currentShare,
      });
    });

    await act(async () => {
      initialShare.reject(new Error('stale share read failed'));
      await expect(initialShare.promise).rejects.toThrow('stale share read failed');
    });

    expect(result.current.walletShareInfo).toEqual(currentShare);
  });

  it('keeps current group access and prevents stale group controls after an initial read resolves last', async () => {
    const initialShare = createDeferred<Awaited<ReturnType<typeof walletsApi.getWalletShareInfo>>>();
    const currentShare = {
      users: [],
      group: { id: 'group-current', name: 'Current group' },
    };
    vi.mocked(walletsApi.getWalletShareInfo)
      .mockReturnValueOnce(initialShare.promise)
      .mockResolvedValue(currentShare as never);
    vi.mocked(walletsApi.shareWalletWithGroup).mockResolvedValue({ success: true } as never);

    const { result } = renderHook(() => {
      const data = useWalletData({ id: 'wallet-1', user: defaultUser });
      const sharing = useWalletSharing({
        walletId: 'wallet-1',
        wallet: data.wallet,
        devices: data.devices,
        walletShareInfo: data.walletShareInfo,
        groups: data.groups,
        refreshWalletShareInfo: data.refreshWalletShareInfo,
        setWallet: data.setWallet,
      });
      return { data, sharing };
    });

    await waitFor(() => expect(walletsApi.getWalletShareInfo).toHaveBeenCalledTimes(1));
    act(() => result.current.sharing.setSelectedGroupToAdd('group-current'));
    await act(async () => result.current.sharing.addGroup('viewer'));
    expect(result.current.data.walletShareInfo).toEqual(currentShare);

    await act(async () => {
      initialShare.resolve({
        users: [],
        group: { id: 'group-obsolete', name: 'Obsolete group' },
      } as never);
      await initialShare.promise;
    });
    expect(result.current.data.walletShareInfo).toEqual(currentShare);

    vi.mocked(walletsApi.shareWalletWithGroup).mockClear();
    await act(async () => result.current.sharing.updateGroupRole('signer'));
    expect(walletsApi.shareWalletWithGroup).toHaveBeenCalledWith('wallet-1', {
      groupId: 'group-current',
      role: 'signer',
    });
  });
});
