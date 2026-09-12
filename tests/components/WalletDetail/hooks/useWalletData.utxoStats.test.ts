import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletData } from '../../../../src/components/WalletDetail/hooks/useWalletData';
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

// This file covers the "load UTXO stats once per wallet" contract in
// isolation from tests/components/WalletDetail/hooks/useWalletData.test.ts
// (already at the size cap for that file) — see useWalletDetailController's
// stats-tab effect, which relies on utxoStatsLoadedFor to avoid refetching
// on every loadingUtxoStats false transition.

const mockNavigate = vi.fn();
const mockHandleError = vi.fn();
const mockAddNotification = vi.fn();
const mockRemoveNotificationsByType = vi.fn();
const mockLogError = vi.fn();

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
  logError: (...args: unknown[]) => mockLogError(...args),
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
}));

vi.mock('../../../../src/api/bitcoin', () => ({
  getStatus: vi.fn(),
}));

vi.mock('../../../../src/api/drafts', () => ({
  getDrafts: vi.fn(),
}));

vi.mock('../../../../src/api/auth', () => ({
  getUserGroups: vi.fn(),
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

// The paginated UTXO loader always calls getUTXOs(walletId, { limit, offset }),
// while loadUtxosForStats calls getUTXOs(walletId) with no options object —
// distinguish the two call sites on that shape.
const pagedUtxoPage = {
  count: 300,
  totalBalance: 500000,
  utxos: Array.from({ length: 100 }, (_, i) => makeUtxo(`u-${i}`)),
};

describe('useWalletData UTXO stats attempted-tracking', () => {
  const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError: mockHandleError } as never);
    vi.mocked(useAppNotifications).mockReturnValue({
      addNotification: mockAddNotification,
      removeNotificationsByType: mockRemoveNotificationsByType,
    } as never);

    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId: string) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    } as never));
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ users: [], group: null } as never);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: 'https://mempool.space' } as never);

    vi.mocked(devicesApi.getDevices).mockResolvedValue([] as never);

    vi.mocked(transactionsApi.getTransactions).mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeTx(`tx-${i}`)) as never);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValue({ count: 50 } as never);
    vi.mocked(transactionsApi.getUTXOs).mockImplementation((async (_walletId: string, options?: unknown) => (
      options ? pagedUtxoPage : { count: 0, totalBalance: 0, utxos: [] }
    )) as never);
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

  afterEach(() => {
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
  });

  it('marks the wallet as attempted after an empty stats load resolves', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-1'));

    await act(async () => {
      await view.result.current.loadUtxosForStats('wallet-1');
    });

    expect(view.result.current.utxoStats).toEqual([]);
    expect(view.result.current.utxoStatsLoadedFor).toBe('wallet-1');
    expect(view.result.current.loadingUtxoStats).toBe(false);
  });

  it('marks the wallet as attempted even when the stats load rejects', async () => {
    vi.mocked(transactionsApi.getUTXOs).mockImplementation((async (_walletId: string, options?: unknown) => {
      if (options) return pagedUtxoPage;
      throw new Error('stats load failed');
    }) as never);

    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-1'));

    await act(async () => {
      await view.result.current.loadUtxosForStats('wallet-1');
    });

    expect(view.result.current.utxoStatsLoadedFor).toBe('wallet-1');
    expect(view.result.current.loadingUtxoStats).toBe(false);
    expect(mockLogError).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Error),
      'Failed to load UTXOs for stats',
    );
  });

  it('resets utxoStatsLoadedFor to null on a route change', async () => {
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-1' as string } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-1'));

    await act(async () => {
      await view.result.current.loadUtxosForStats('wallet-1');
    });
    expect(view.result.current.utxoStatsLoadedFor).toBe('wallet-1');

    view.rerender({ id: 'wallet-2' });
    expect(view.result.current.utxoStatsLoadedFor).toBeNull();

    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-2'));
    expect(view.result.current.utxoStatsLoadedFor).toBeNull();
  });

  it('does not mark a stale route as attempted when it resolves after a route change', async () => {
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' as string } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));

    const staleStats = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    vi.mocked(transactionsApi.getUTXOs).mockImplementation((async (_walletId: string, options?: unknown) => (
      options ? pagedUtxoPage : staleStats.promise
    )) as never);

    let stalePromise!: Promise<void>;
    act(() => {
      stalePromise = view.result.current.loadUtxosForStats('wallet-a');
      view.rerender({ id: 'wallet-b' });
    });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));

    await act(async () => {
      staleStats.resolve({ count: 0, totalBalance: 0, utxos: [] } as never);
      await stalePromise;
    });

    expect(view.result.current.utxoStatsLoadedFor).not.toBe('wallet-a');
  });
});
