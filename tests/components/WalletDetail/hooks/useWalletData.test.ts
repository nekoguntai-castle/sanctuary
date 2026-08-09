import { act,renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useWalletData } from '../../../../src/components/WalletDetail/hooks/useWalletData';
import { useAppNotifications } from '../../../../src/contexts/AppNotificationContext';
import { useErrorHandler } from '../../../../src/hooks/useErrorHandler';
import * as adminApi from '../../../../src/api/admin';
import * as authApi from '../../../../src/api/auth';
import * as bitcoinApi from '../../../../src/api/bitcoin';
import { ApiError } from '../../../../src/api/client';
import * as devicesApi from '../../../../src/api/devices';
import * as draftsApi from '../../../../src/api/drafts';
import * as transactionsApi from '../../../../src/api/transactions';
import * as walletsApi from '../../../../src/api/wallets';
import type { Wallet } from '../../../../src/types';

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

describe('useWalletData', () => {
  const originalVisibilityDescriptor = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useErrorHandler).mockReturnValue({ handleError: mockHandleError } as never);
    vi.mocked(useAppNotifications).mockReturnValue({
      addNotification: mockAddNotification,
      removeNotificationsByType: mockRemoveNotificationsByType,
    } as never);

    vi.mocked(walletsApi.getWallet).mockResolvedValue(baseWallet as never);
    vi.mocked(walletsApi.getWalletShareInfo).mockResolvedValue({ users: [], group: null } as never);

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: 'https://mempool.space' } as never);

    vi.mocked(devicesApi.getDevices).mockResolvedValue([
      {
        id: 'device-1',
        type: 'ledger',
        label: 'Ledger',
        fingerprint: 'ff11',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: 'xpub-device-1',
        wallets: [{ wallet: { id: 'wallet-1' } }],
        accounts: [{ purpose: 'multisig', scriptType: 'wsh', derivationPath: "m/48'/0'/0'/2'", xpub: 'xpub-acc-1' }],
      },
      {
        id: 'device-2',
        type: 'trezor',
        label: 'Trezor',
        fingerprint: 'ff22',
        derivationPath: "m/48'/0'/0'/2'",
        xpub: 'xpub-device-2',
        wallets: [{ wallet: { id: 'wallet-1' } }],
        accounts: [{ purpose: 'single_sig', scriptType: 'wpkh', derivationPath: "m/84'/0'/0'", xpub: 'xpub-acc-2' }],
      },
    ] as never);

    vi.mocked(transactionsApi.getTransactions).mockResolvedValue(Array.from({ length: 50 }, (_, i) => makeTx(`tx-${i}`)) as never);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValue({ count: 50 } as never);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      count: 300,
      totalBalance: 500000,
      utxos: Array.from({ length: 100 }, (_, i) => makeUtxo(`u-${i}`)),
    } as never);
    vi.mocked(transactionsApi.getWalletPrivacy).mockResolvedValue({
      utxos: [{ id: 'u-1', score: 50 }],
      summary: { score: 70 },
    } as never);
    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValue({ totalAddresses: 2 } as never);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([makeAddress('a-1')] as never);

    vi.mocked(draftsApi.getDrafts).mockResolvedValue([{ id: 'd-1' }, { id: 'd-2' }] as never);
    vi.mocked(adminApi.getGroups).mockResolvedValue([
      { id: 'g-1', name: 'Ops', description: 'Operators', members: [{ userId: 'user-1' }, { userId: 'user-2' }] },
    ] as never);
    vi.mocked(authApi.getUserGroups).mockResolvedValue([{ id: 'g-u', name: 'User Group' }] as never);
  });

  afterEach(() => {
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
  });

  it('keeps wallet B state when wallet A resolves after a route change', async () => {
    const walletA = createDeferred<typeof baseWallet>();
    vi.mocked(walletsApi.getWallet).mockImplementation((walletId) => (
      walletId === 'wallet-a'
        ? walletA.promise as ReturnType<typeof walletsApi.getWallet>
        : Promise.resolve({
            ...baseWallet,
            id: 'wallet-b',
            name: 'Wallet B',
          }) as ReturnType<typeof walletsApi.getWallet>
    ));
    const { result, rerender } = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledWith('wallet-a'));

    rerender({ id: 'wallet-b' });
    await waitFor(() => expect(result.current.wallet?.id).toBe('wallet-b'));
    expect(result.current.loading).toBe(false);

    await act(async () => {
      walletA.resolve({ ...baseWallet, id: 'wallet-a', name: 'Wallet A' });
      await walletA.promise;
    });

    expect(result.current.wallet?.id).toBe('wallet-b');
    expect(result.current.wallet?.name).toBe('Wallet B');
    expect(transactionsApi.getTransactions).not.toHaveBeenCalledWith(
      'wallet-a',
      expect.anything(),
    );
  });

  it('clears every wallet-owned field before loading a partially failing wallet B', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValueOnce({
      explorerUrl: 'https://wallet-a.example',
    } as never);
    const walletB = createDeferred<typeof baseWallet>();
    vi.mocked(walletsApi.getWallet).mockImplementation((walletId) => (
      walletId === 'wallet-b'
        ? walletB.promise as ReturnType<typeof walletsApi.getWallet>
        : Promise.resolve(baseWallet) as ReturnType<typeof walletsApi.getWallet>
    ));
    const { result, rerender } = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-1' } },
    );
    await waitFor(() => expect(result.current.wallet?.id).toBe('wallet-1'));
    await act(async () => {
      await result.current.loadUtxosForStats('wallet-1');
    });
    expect(result.current.transactions.length).toBeGreaterThan(0);
    expect(result.current.utxoStats.length).toBeGreaterThan(0);

    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('B status failed'));
    vi.mocked(devicesApi.getDevices).mockRejectedValueOnce(new Error('B devices failed'));
    vi.mocked(transactionsApi.getTransactions).mockRejectedValueOnce(new Error('B tx failed'));
    vi.mocked(transactionsApi.getTransactionStats).mockRejectedValueOnce(new Error('B stats failed'));
    vi.mocked(transactionsApi.getUTXOs).mockRejectedValueOnce(new Error('B UTXO failed'));
    vi.mocked(transactionsApi.getWalletPrivacy).mockRejectedValueOnce(new Error('B privacy failed'));
    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValueOnce(new Error('B summary failed'));
    vi.mocked(transactionsApi.getAddresses).mockRejectedValueOnce(new Error('B addresses failed'));
    vi.mocked(draftsApi.getDrafts).mockRejectedValueOnce(new Error('B drafts failed'));
    vi.mocked(adminApi.getGroups).mockRejectedValueOnce(new Error('B groups failed'));
    vi.mocked(walletsApi.getWalletShareInfo).mockRejectedValueOnce(new Error('B share failed'));

    rerender({ id: 'wallet-b' });
    expect(result.current.wallet).toBeNull();
    expect(result.current.devices).toEqual([]);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.transactionStats).toBeNull();
    expect(result.current.utxos).toEqual([]);
    expect(result.current.utxoSummary).toBeNull();
    expect(result.current.utxoStats).toEqual([]);
    expect(result.current.privacyData).toEqual([]);
    expect(result.current.privacySummary).toBeNull();
    expect(result.current.addresses).toEqual([]);
    expect(result.current.addressSummary).toBeNull();
    expect(result.current.draftsCount).toBe(0);
    expect(result.current.groups).toEqual([]);
    expect(result.current.walletShareInfo).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      walletB.resolve({ ...baseWallet, id: 'wallet-b', name: 'Wallet B' });
      await walletB.promise;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.wallet?.id).toBe('wallet-b');
    expect(result.current.devices).toEqual([]);
    expect(result.current.transactions).toEqual([]);
    expect(result.current.transactionStats).toBeNull();
    expect(result.current.utxos).toEqual([]);
    expect(result.current.utxoSummary).toBeNull();
    expect(result.current.privacyData).toEqual([]);
    expect(result.current.addresses).toEqual([]);
    expect(result.current.addressSummary).toBeNull();
    expect(result.current.groups).toEqual([]);
    expect(result.current.walletShareInfo).toBeNull();
    expect(result.current.explorerUrl).not.toBe('https://wallet-a.example');
  });

  it('rejects a retained wallet A address callback before it can mutate wallet B', async () => {
    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    }));
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));
    const retainedLoadAddresses = view.result.current.loadAddresses;
    const retainedLoadAddressSummary = view.result.current.loadAddressSummary;

    view.rerender({ id: 'wallet-b' });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));
    const addressCalls = vi.mocked(transactionsApi.getAddresses).mock.calls.length;
    const summaryCalls = vi.mocked(transactionsApi.getAddressSummary).mock.calls.length;
    const addresses = view.result.current.addresses;
    const offset = view.result.current.addressOffset;

    await act(async () => {
      await retainedLoadAddresses('wallet-a', 1, 0, true);
      await retainedLoadAddresses('wallet-a', 1, 0, false);
      await retainedLoadAddressSummary('wallet-a');
    });

    expect(transactionsApi.getAddresses).toHaveBeenCalledTimes(addressCalls);
    expect(transactionsApi.getAddressSummary).toHaveBeenCalledTimes(summaryCalls);
    expect(view.result.current.addresses).toEqual(addresses);
    expect(view.result.current.addressOffset).toBe(offset);
    expect(view.result.current.loadingAddresses).toBe(false);
  });

  it('fences in-flight address reset success and failure after a route change', async () => {
    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    }));
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));

    const staleSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(staleSuccess.promise);
    let success!: Promise<void>;
    act(() => {
      success = view.result.current.loadAddresses('wallet-a', 25, 0, true);
      view.rerender({ id: 'wallet-b' });
    });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));
    await act(async () => {
      staleSuccess.resolve([makeAddress('stale-success')] as never);
      await success;
    });
    expect(view.result.current.addresses.map(address => address.id)).toEqual(['a-1']);

    const staleFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(staleFailure.promise);
    let failure!: Promise<void>;
    act(() => {
      failure = view.result.current.loadAddresses('wallet-b', 25, 0, true);
      view.rerender({ id: 'wallet-c' });
    });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-c'));
    await act(async () => {
      staleFailure.reject(new Error('stale reset failure'));
      await failure;
    });
    expect(view.result.current.addresses.map(address => address.id)).toEqual(['a-1']);
    expect(view.result.current.loadingAddresses).toBe(false);
  });

  it('rejects a retained wallet A UTXO callback before it can mutate wallet B', async () => {
    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    }));
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));
    const retainedLoadMoreUtxos = view.result.current.loadMoreUtxos;

    view.rerender({ id: 'wallet-b' });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));
    const utxoCalls = vi.mocked(transactionsApi.getUTXOs).mock.calls.length;
    const utxos = view.result.current.utxos;
    const summary = view.result.current.utxoSummary;

    await act(async () => {
      await retainedLoadMoreUtxos();
    });

    expect(transactionsApi.getUTXOs).toHaveBeenCalledTimes(utxoCalls);
    expect(view.result.current.utxos).toEqual(utxos);
    expect(view.result.current.utxoSummary).toEqual(summary);
    expect(view.result.current.loadingMoreUtxos).toBe(false);
  });

  it('rejects a retained wallet A stats callback before it can mutate wallet B', async () => {
    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    }));
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));
    const retainedLoadStats = view.result.current.loadUtxosForStats;

    view.rerender({ id: 'wallet-b' });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));
    const utxoCalls = vi.mocked(transactionsApi.getUTXOs).mock.calls.length;
    const stats = view.result.current.utxoStats;

    await act(async () => {
      await retainedLoadStats('wallet-a');
    });

    expect(transactionsApi.getUTXOs).toHaveBeenCalledTimes(utxoCalls);
    expect(view.result.current.utxoStats).toEqual(stats);
    expect(view.result.current.loadingUtxoStats).toBe(false);
  });

  it('rejects a retained wallet A transaction callback before it can mutate wallet B', async () => {
    vi.mocked(walletsApi.getWallet).mockImplementation(async (walletId) => ({
      ...baseWallet,
      id: walletId,
      name: walletId,
    }));
    const view = renderHook(
      ({ id }) => useWalletData({ id, user: defaultUser }),
      { initialProps: { id: 'wallet-a' } },
    );
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-a'));
    const retainedLoadMoreTransactions = view.result.current.loadMoreTransactions;
    const retainedRefresh = view.result.current.fetchData;

    view.rerender({ id: 'wallet-b' });
    await waitFor(() => expect(view.result.current.wallet?.id).toBe('wallet-b'));
    const transactionCalls = vi.mocked(transactionsApi.getTransactions).mock.calls.length;
    const walletCalls = vi.mocked(walletsApi.getWallet).mock.calls.length;
    const transactions = view.result.current.transactions;
    const offset = view.result.current.txOffset;

    await act(async () => {
      await retainedLoadMoreTransactions();
      await retainedRefresh(true);
    });

    expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(transactionCalls);
    expect(walletsApi.getWallet).toHaveBeenCalledTimes(walletCalls);
    expect(view.result.current.transactions).toEqual(transactions);
    expect(view.result.current.txOffset).toBe(offset);
    expect(view.result.current.loadingMoreTx).toBe(false);
  });

  it('ignores a wallet request that resolves after unmount', async () => {
    const wallet = createDeferred<typeof baseWallet>();
    vi.mocked(walletsApi.getWallet).mockReturnValue(
      wallet.promise as ReturnType<typeof walletsApi.getWallet>,
    );
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalled());
    view.unmount();

    await act(async () => {
      wallet.resolve(baseWallet);
      await wallet.promise;
    });

    expect(transactionsApi.getTransactions).not.toHaveBeenCalled();
    expect(mockAddNotification).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('keeps the newest of two same-wallet refreshes', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const older = createDeferred<typeof baseWallet>();
    const newer = createDeferred<typeof baseWallet>();
    vi.mocked(walletsApi.getWallet)
      .mockReturnValueOnce(older.promise as ReturnType<typeof walletsApi.getWallet>)
      .mockReturnValueOnce(newer.promise as ReturnType<typeof walletsApi.getWallet>);

    let olderRefresh!: Promise<void>;
    let newerRefresh!: Promise<void>;
    act(() => {
      olderRefresh = result.current.fetchData(true);
      newerRefresh = result.current.fetchData(true);
    });
    await act(async () => {
      newer.resolve({ ...baseWallet, name: 'Newest Wallet' });
      await newerRefresh;
    });
    expect(result.current.wallet?.name).toBe('Newest Wallet');

    await act(async () => {
      older.resolve({ ...baseWallet, name: 'Older Wallet' });
      await olderRefresh;
    });
    expect(result.current.wallet?.name).toBe('Newest Wallet');
  });

  it('replays a WebSocket confirmation reducer over a deferred initial transaction page', async () => {
    const delayed = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    vi.mocked(transactionsApi.getTransactions).mockReturnValueOnce(delayed.promise);
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(1));
    expect(view.result.current).toMatchObject({ transactions: [], loadingMoreTx: true });

    act(() => {
      view.result.current.setTransactions(current => current.map(transaction => (
        transaction.txid === 'initial-tx'
          ? { ...transaction, confirmations: 6 }
          : transaction
      )));
    });
    expect(view.result.current).toMatchObject({ transactions: [], loadingMoreTx: true });

    await act(async () => {
      delayed.resolve([makeTx('initial-tx')] as never);
      await delayed.promise;
    });
    await waitFor(() => expect(view.result.current.transactions).toHaveLength(1));
    expect(view.result.current).toMatchObject({
      transactions: [{ id: 'initial-tx', txid: 'initial-tx', confirmations: 6 }],
      loadingMoreTx: false,
      txOffset: 1,
      hasMoreTx: false,
    });
  });

  it('keeps prior transaction stats when a replacement page succeeds without fresh stats', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    vi.mocked(transactionsApi.getTransactions).mockResolvedValueOnce([makeTx('refreshed')] as never);
    vi.mocked(transactionsApi.getTransactionStats).mockRejectedValueOnce(new Error('stats unavailable'));

    await act(async () => {
      await view.result.current.fetchData(true);
    });

    expect(view.result.current.transactions[0].id).toBe('refreshed');
    expect(view.result.current.transactionStats).toEqual({ count: 50 });
  });

  it('keeps a WebSocket-style transaction mutation over delayed auxiliary replacement', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const calls = vi.mocked(transactionsApi.getTransactions).mock.calls.length;
    const delayed = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    vi.mocked(transactionsApi.getTransactions).mockReturnValueOnce(delayed.promise);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValueOnce({ count: 999 } as never);

    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.fetchData(true);
    });
    await waitFor(() => expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(calls + 1));
    act(() => {
      view.result.current.setTransactions(current => current.map(transaction => (
        transaction.txid === 'tx-0' ? { ...transaction, confirmations: 42 } : transaction
      )));
    });
    expect(view.result.current.loadingMoreTx).toBe(true);

    await act(async () => {
      delayed.resolve([makeTx('tx-0')] as never);
      await refresh;
    });
    expect(view.result.current.transactions[0].confirmations).toBe(42);
    expect(view.result.current.transactions[0].id).toBe('tx-0');
    expect(view.result.current.transactionStats).toEqual({ count: 999 });
  });

  it('keeps a UTXO action mutation over delayed auxiliary replacement', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const calls = vi.mocked(transactionsApi.getUTXOs).mock.calls.length;
    const delayed = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    vi.mocked(transactionsApi.getUTXOs).mockReturnValueOnce(delayed.promise);

    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.fetchData(true);
    });
    await waitFor(() => expect(transactionsApi.getUTXOs).toHaveBeenCalledTimes(calls + 1));
    act(() => {
      view.result.current.setUTXOs(current => current.map(utxo => (
        utxo.id === 'u-0' ? { ...utxo, frozen: true } : utxo
      )));
    });
    expect(view.result.current.loadingMoreUtxos).toBe(true);

    await act(async () => {
      delayed.resolve({
        count: 999,
        totalBalance: 999_000,
        utxos: [makeUtxo('u-0')],
      } as never);
      await refresh;
    });
    expect(view.result.current.utxos[0].frozen).toBe(true);
    expect(view.result.current.utxos[0].id).toBe('u-0');
    expect(view.result.current.utxoSummary).toEqual({ count: 999, totalBalance: 999_000 });
  });

  it('keeps an address-label mutation over delayed auxiliary replacement', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const calls = vi.mocked(transactionsApi.getAddresses).mock.calls.length;
    const delayed = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(delayed.promise);
    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValueOnce({ totalAddresses: 999 } as never);

    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.fetchData(true);
    });
    await waitFor(() => expect(transactionsApi.getAddresses).toHaveBeenCalledTimes(calls + 1));
    act(() => {
      view.result.current.setAddresses(current => current.map(address => (
        address.id === 'a-1' ? {
          ...address,
          labels: [{ id: 'new-label', walletId: 'wallet-1', name: 'New label', color: '#fff' }],
        } : address
      )));
    });
    expect(view.result.current.loadingAddresses).toBe(true);

    await act(async () => {
      delayed.resolve([makeAddress('a-1')] as never);
      await refresh;
    });
    expect(view.result.current.addresses[0].labels).toEqual([
      { id: 'new-label', walletId: 'wallet-1', name: 'New label', color: '#fff' },
    ]);
    expect(view.result.current.addresses[0].id).toBe('a-1');
    expect(view.result.current.addressSummary).toEqual({ totalAddresses: 999 });
  });

  it('invalidates pending pages for every collection when a shifted refresh replaces page one', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const oldTransactions = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    const oldUtxos = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const oldAddresses = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getTransactions)
      .mockReturnValueOnce(oldTransactions.promise)
      .mockResolvedValueOnce([makeTx('fresh-tx')] as never);
    vi.mocked(transactionsApi.getUTXOs)
      .mockReturnValueOnce(oldUtxos.promise)
      .mockResolvedValueOnce({ count: 1, totalBalance: 2000, utxos: [makeUtxo('fresh-utxo')] } as never);
    vi.mocked(transactionsApi.getAddresses)
      .mockReturnValueOnce(oldAddresses.promise)
      .mockResolvedValueOnce([makeAddress('fresh-address')] as never);
    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValueOnce({ totalAddresses: 1 } as never);

    let oldPages!: Promise<void>[];
    let refresh!: Promise<void>;
    act(() => {
      oldPages = [
        view.result.current.loadMoreTransactions(),
        view.result.current.loadMoreUtxos(),
        view.result.current.loadAddresses('wallet-1', 25, view.result.current.addressOffset, false),
      ];
      refresh = view.result.current.fetchData(true);
    });
    await act(async () => refresh);

    await act(async () => {
      oldTransactions.resolve([makeTx('stale-tx')] as never);
      oldUtxos.resolve({ count: 2, totalBalance: 3000, utxos: [makeUtxo('stale-utxo')] } as never);
      oldAddresses.resolve([makeAddress('stale-address')] as never);
      await Promise.all(oldPages);
    });

    expect(view.result.current.transactions.map(transaction => transaction.id)).toEqual(['fresh-tx']);
    expect(view.result.current.utxos.map(utxo => utxo.id)).toEqual(['fresh-utxo']);
    expect(view.result.current.addresses.map(address => address.id)).toEqual(['fresh-address']);
    expect(view.result.current.txOffset).toBe(1);
    expect(view.result.current.addressOffset).toBe(1);
    expect(view.result.current.hasMoreTx).toBe(false);
    expect(view.result.current.hasMoreUtxos).toBe(false);
    expect(view.result.current.hasMoreAddresses).toBe(false);
    expect(view.result.current.loadingMoreTx).toBe(false);
    expect(view.result.current.loadingMoreUtxos).toBe(false);
    expect(view.result.current.loadingAddresses).toBe(false);
  });

  it('does not report a stale continuation failure after a replacement', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const oldPage = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    vi.mocked(transactionsApi.getTransactions)
      .mockReturnValueOnce(oldPage.promise)
      .mockResolvedValueOnce([makeTx('fresh')] as never);

    let continuation!: Promise<void>;
    let refresh!: Promise<void>;
    act(() => {
      continuation = view.result.current.loadMoreTransactions();
      refresh = view.result.current.fetchData(true);
    });
    await act(async () => refresh);
    await act(async () => {
      oldPage.reject(new Error('stale page failure'));
      await continuation;
    });

    expect(view.result.current.transactions.map(transaction => transaction.id)).toEqual(['fresh']);
    expect(mockHandleError).not.toHaveBeenCalledWith(
      expect.anything(),
      'Failed to Load More Transactions',
    );
    expect(view.result.current.loadingMoreTx).toBe(false);
  });

  it('claims at most one same-tick continuation for each collection', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const transactionCalls = vi.mocked(transactionsApi.getTransactions).mock.calls.length;
    const utxoCalls = vi.mocked(transactionsApi.getUTXOs).mock.calls.length;
    const addressCalls = vi.mocked(transactionsApi.getAddresses).mock.calls.length;
    const transactions = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    const utxos = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const addresses = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getTransactions).mockReturnValueOnce(transactions.promise);
    vi.mocked(transactionsApi.getUTXOs).mockReturnValueOnce(utxos.promise);
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(addresses.promise);

    let requests!: Promise<void>[];
    act(() => {
      requests = [
        view.result.current.loadMoreTransactions(),
        view.result.current.loadMoreTransactions(),
        view.result.current.loadMoreUtxos(),
        view.result.current.loadMoreUtxos(),
        view.result.current.loadAddresses('wallet-1', 25, view.result.current.addressOffset, false),
        view.result.current.loadAddresses('wallet-1', 25, view.result.current.addressOffset, false),
      ];
    });
    expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(transactionCalls + 1);
    expect(transactionsApi.getUTXOs).toHaveBeenCalledTimes(utxoCalls + 1);
    expect(transactionsApi.getAddresses).toHaveBeenCalledTimes(addressCalls + 1);

    await act(async () => {
      transactions.resolve([makeTx('next')] as never);
      utxos.resolve({ count: 101, totalBalance: 600000, utxos: [makeUtxo('next')] } as never);
      addresses.resolve([makeAddress('next')] as never);
      await Promise.all(requests);
    });
    expect(view.result.current.transactions.filter(transaction => transaction.id === 'next')).toHaveLength(1);
    expect(view.result.current.utxos.filter(utxo => utxo.id === 'next')).toHaveLength(1);
    expect(view.result.current.addresses.filter(address => address.id === 'next')).toHaveLength(1);
  });

  it('refuses continuations while a replacement is pending', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const core = createDeferred<Wallet>();
    vi.mocked(walletsApi.getWallet).mockReturnValueOnce(core.promise);
    const transactionCalls = vi.mocked(transactionsApi.getTransactions).mock.calls.length;
    const utxoCalls = vi.mocked(transactionsApi.getUTXOs).mock.calls.length;
    const addressCalls = vi.mocked(transactionsApi.getAddresses).mock.calls.length;

    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.fetchData(true);
      void view.result.current.loadMoreTransactions();
      void view.result.current.loadMoreUtxos();
      void view.result.current.loadAddresses('wallet-1', 25, view.result.current.addressOffset, false);
    });
    expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(transactionCalls);
    expect(transactionsApi.getUTXOs).toHaveBeenCalledTimes(utxoCalls);
    expect(transactionsApi.getAddresses).toHaveBeenCalledTimes(addressCalls);

    await act(async () => {
      core.resolve(baseWallet);
      await refresh;
    });
  });

  it('fences delayed address-summary success and failure behind the address epoch', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    const staleSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddressSummary>>>();
    vi.mocked(transactionsApi.getAddressSummary)
      .mockReturnValueOnce(staleSuccess.promise)
      .mockResolvedValueOnce({ totalAddresses: 3 } as never);
    const oldSuccess = view.result.current.loadAddressSummary('wallet-1');
    await act(async () => {
      await view.result.current.loadAddresses('wallet-1', 25, 0, true);
    });
    await act(async () => {
      staleSuccess.resolve({ totalAddresses: 999 } as never);
      await oldSuccess;
    });
    expect(view.result.current.addressSummary?.totalAddresses).toBe(3);

    const staleFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddressSummary>>>();
    vi.mocked(transactionsApi.getAddressSummary)
      .mockReturnValueOnce(staleFailure.promise)
      .mockResolvedValueOnce({ totalAddresses: 4 } as never);
    const oldFailure = view.result.current.loadAddressSummary('wallet-1');
    await act(async () => {
      await view.result.current.loadAddresses('wallet-1', 25, 0, true);
    });
    await act(async () => {
      staleFailure.reject(new Error('old summary failed'));
      await oldFailure;
    });
    expect(view.result.current.addressSummary?.totalAddresses).toBe(4);
    expect(view.result.current.loadingAddresses).toBe(false);
  });

  it('keeps the newest of two same-wallet address resets', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const olderAddresses = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getAddresses)
      .mockReturnValueOnce(olderAddresses.promise)
      .mockResolvedValueOnce([makeAddress('newest-reset')] as never);
    vi.mocked(transactionsApi.getAddressSummary)
      .mockResolvedValueOnce({ totalAddresses: 99 } as never)
      .mockResolvedValueOnce({ totalAddresses: 1 } as never);

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = view.result.current.loadAddresses('wallet-1', 25, 0, true);
      newer = view.result.current.loadAddresses('wallet-1', 25, 0, true);
    });
    await act(async () => newer);
    await act(async () => {
      olderAddresses.resolve([makeAddress('older-reset')] as never);
      await older;
    });

    expect(view.result.current.addresses.map(address => address.id)).toEqual(['newest-reset']);
    expect(view.result.current.addressSummary?.totalAddresses).toBe(1);
    expect(view.result.current.loadingAddresses).toBe(false);
  });

  it('does not let a superseded base refresh overwrite address reset metadata', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const initialAddressCalls = vi.mocked(transactionsApi.getAddresses).mock.calls.length;
    const staleAddresses = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    vi.mocked(transactionsApi.getAddresses)
      .mockReturnValueOnce(staleAddresses.promise)
      .mockResolvedValueOnce([makeAddress('reset-address')] as never);
    vi.mocked(transactionsApi.getAddressSummary)
      .mockResolvedValueOnce({ totalAddresses: 999 } as never)
      .mockResolvedValueOnce({ totalAddresses: 1 } as never);

    let refresh!: Promise<void>;
    act(() => {
      refresh = view.result.current.fetchData(true);
    });
    await waitFor(() => expect(transactionsApi.getAddresses).toHaveBeenCalledTimes(initialAddressCalls + 1));
    await act(async () => {
      await view.result.current.loadAddresses('wallet-1', 25, 0, true);
    });
    await act(async () => {
      staleAddresses.resolve([makeAddress('stale-refresh-address')] as never);
      await refresh;
    });

    expect(view.result.current.addresses.map(address => address.id)).toEqual(['reset-address']);
    expect(view.result.current.addressSummary?.totalAddresses).toBe(1);
    expect(view.result.current.hasMoreAddresses).toBe(false);
  });

  it('ignores a stale core failure after a newer same-wallet refresh succeeds', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const older = createDeferred<Wallet>();
    vi.mocked(walletsApi.getWallet)
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce({ ...baseWallet, name: 'Current Wallet' });

    let olderRefresh!: Promise<void>;
    let newerRefresh!: Promise<void>;
    act(() => {
      olderRefresh = result.current.fetchData(true);
      newerRefresh = result.current.fetchData(true);
    });
    await act(async () => {
      await newerRefresh;
    });

    await act(async () => {
      older.reject(new Error('stale core failure'));
      await olderRefresh;
    });

    expect(result.current.wallet?.name).toBe('Current Wallet');
    expect(result.current.error).toBeNull();
  });

  it('ignores stale pagination completions and failures after unmount', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    const addressSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    const utxoSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const statsSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const txSuccess = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(addressSuccess.promise);
    vi.mocked(transactionsApi.getUTXOs)
      .mockReturnValueOnce(utxoSuccess.promise)
      .mockReturnValueOnce(statsSuccess.promise);
    vi.mocked(transactionsApi.getTransactions).mockReturnValueOnce(txSuccess.promise);

    let successes!: Promise<void>[];
    act(() => {
      successes = [
        view.result.current.loadAddresses('wallet-1', 1, 0),
        view.result.current.loadMoreUtxos(),
        view.result.current.loadUtxosForStats('wallet-1'),
        view.result.current.loadMoreTransactions(),
      ];
    });
    view.unmount();
    addressSuccess.resolve([makeAddress('stale')] as never);
    utxoSuccess.resolve({ count: 1, totalBalance: 1000, utxos: [makeUtxo('stale')] } as never);
    statsSuccess.resolve({ count: 1, totalBalance: 1000, utxos: [makeUtxo('stale')] } as never);
    txSuccess.resolve([makeTx('stale')] as never);
    await Promise.all(successes);

    const failedView = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(failedView.result.current.loading).toBe(false));
    const addressFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getAddresses>>>();
    const utxoFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const statsFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getUTXOs>>>();
    const txFailure = createDeferred<Awaited<ReturnType<typeof transactionsApi.getTransactions>>>();
    vi.mocked(transactionsApi.getAddresses).mockReturnValueOnce(addressFailure.promise);
    vi.mocked(transactionsApi.getUTXOs)
      .mockReturnValueOnce(utxoFailure.promise)
      .mockReturnValueOnce(statsFailure.promise);
    vi.mocked(transactionsApi.getTransactions).mockReturnValueOnce(txFailure.promise);

    let failures!: Promise<void>[];
    act(() => {
      failures = [
        failedView.result.current.loadAddresses('wallet-1', 1, 0),
        failedView.result.current.loadMoreUtxos(),
        failedView.result.current.loadUtxosForStats('wallet-1'),
        failedView.result.current.loadMoreTransactions(),
      ];
    });
    failedView.unmount();
    addressFailure.reject(new Error('stale address failure'));
    utxoFailure.reject(new Error('stale UTXO failure'));
    statsFailure.reject(new Error('stale stats failure'));
    txFailure.reject(new Error('stale transaction failure'));
    await Promise.all(failures);
  });

  it('ignores older refreshes that become stale during auxiliary, group, or share loading', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const staleAux = createDeferred<Awaited<ReturnType<typeof bitcoinApi.getStatus>>>();
    const statusCalls = vi.mocked(bitcoinApi.getStatus).mock.calls.length;
    vi.mocked(bitcoinApi.getStatus)
      .mockReturnValueOnce(staleAux.promise)
      .mockResolvedValueOnce({ explorerUrl: 'https://current.example' } as never);
    let staleAuxRefresh!: Promise<void>;
    act(() => {
      staleAuxRefresh = result.current.fetchData(true);
    });
    await waitFor(() => expect(bitcoinApi.getStatus).toHaveBeenCalledTimes(statusCalls + 1));
    await act(async () => {
      await result.current.fetchData(true);
    });
    await act(async () => {
      staleAux.resolve({ explorerUrl: 'https://stale.example' } as never);
      await staleAuxRefresh;
    });

    const staleGroups = createDeferred<Awaited<ReturnType<typeof adminApi.getGroups>>>();
    const groupCalls = vi.mocked(adminApi.getGroups).mock.calls.length;
    vi.mocked(adminApi.getGroups)
      .mockReturnValueOnce(staleGroups.promise)
      .mockResolvedValueOnce([]);
    let staleGroupRefresh!: Promise<void>;
    act(() => {
      staleGroupRefresh = result.current.fetchData(true);
    });
    await waitFor(() => expect(adminApi.getGroups).toHaveBeenCalledTimes(groupCalls + 1));
    await act(async () => {
      await result.current.fetchData(true);
    });
    await act(async () => {
      staleGroups.resolve([]);
      await staleGroupRefresh;
    });

    const staleShare = createDeferred<Awaited<ReturnType<typeof walletsApi.getWalletShareInfo>>>();
    const shareCalls = vi.mocked(walletsApi.getWalletShareInfo).mock.calls.length;
    vi.mocked(walletsApi.getWalletShareInfo)
      .mockReturnValueOnce(staleShare.promise)
      .mockResolvedValueOnce({ users: [], group: null } as never);
    let staleShareRefresh!: Promise<void>;
    act(() => {
      staleShareRefresh = result.current.fetchData(true);
    });
    await waitFor(() => expect(walletsApi.getWalletShareInfo).toHaveBeenCalledTimes(shareCalls + 1));
    await act(async () => {
      await result.current.fetchData(true);
    });
    await act(async () => {
      staleShare.resolve({ users: [], group: null } as never);
      await staleShareRefresh;
    });

    expect(result.current.wallet?.id).toBe('wallet-1');
  });

  it('loads wallet data, maps related resources, and supports pagination actions', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.wallet?.id).toBe('wallet-1');
    expect(result.current.devices).toHaveLength(2);
    expect(result.current.devices[0].accountMissing).toBe(false);
    expect(result.current.devices[1].accountMissing).toBe(true);
    expect(result.current.groups).toEqual([
      {
        id: 'g-1',
        name: 'Ops',
        description: 'Operators',
        memberCount: 2,
        memberIds: ['user-1', 'user-2'],
      },
    ]);
    expect(mockAddNotification).toHaveBeenCalled();
    expect(result.current.walletShareInfo).toEqual({ users: [], group: null });

    vi.mocked(transactionsApi.getTransactions)
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, i) => makeTx(`next-${i}`)) as never)
      .mockRejectedValueOnce(new Error('tx page failed'));

    await act(async () => {
      await result.current.loadMoreTransactions();
    });
    expect(result.current.hasMoreTx).toBe(true);

    await act(async () => {
      await result.current.loadMoreTransactions();
    });
    expect(mockHandleError).toHaveBeenCalledWith(expect.any(Error), 'Failed to Load More Transactions');

    vi.mocked(transactionsApi.getUTXOs)
      .mockResolvedValueOnce({
        count: 300,
        totalBalance: 500000,
        utxos: Array.from({ length: 100 }, (_, i) => makeUtxo(`u-next-${i}`)),
      } as never)
      .mockRejectedValueOnce(new Error('utxo page failed'));

    await act(async () => {
      await result.current.loadMoreUtxos();
    });
    expect(result.current.loadingMoreUtxos).toBe(false);

    await act(async () => {
      await result.current.loadMoreUtxos();
    });
    expect(result.current.loadingMoreUtxos).toBe(false);
  });

  it('loads UTXOs for stats and handles stats load failures', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(transactionsApi.getUTXOs).mockResolvedValueOnce({
      count: 2,
      totalBalance: 2000,
      utxos: [makeUtxo('stats-1'), makeUtxo('stats-2')],
    } as never);

    await act(async () => {
      await result.current.loadUtxosForStats('wallet-1');
    });
    expect(result.current.utxoStats).toHaveLength(2);
    expect(result.current.loadingUtxoStats).toBe(false);

    vi.mocked(transactionsApi.getUTXOs).mockRejectedValueOnce(new Error('stats fail'));
    await act(async () => {
      await result.current.loadUtxosForStats('wallet-1');
    });
    expect(result.current.loadingUtxoStats).toBe(false);
  });

  it('supports address pagination with and without summary metadata', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadAddresses('wallet-1', 1, 0, true);
    });
    expect(result.current.addressOffset).toBe(1);
    expect(result.current.hasMoreAddresses).toBe(true);

    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValueOnce(new Error('summary fail'));
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('fallback-a')] as never);
    await act(async () => {
      await result.current.fetchData(true);
    });

    await act(async () => {
      await result.current.loadAddresses('wallet-1', 1, 0, true);
    });
    expect(result.current.hasMoreAddresses).toBe(true);

    vi.mocked(transactionsApi.getAddresses).mockRejectedValueOnce(new Error('addresses fail'));
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 1, 0, false);
    });
    expect(result.current.loadingAddresses).toBe(false);
  });

  it('handles wallet fetch failures for 404, API errors, and generic errors', async () => {
    vi.mocked(walletsApi.getWallet).mockRejectedValueOnce(new ApiError('not found', 404));
    const { result, rerender } = renderHook(
      ({ id, user }: { id: string | undefined; user: any }) => useWalletData({ id, user }),
      { initialProps: { id: 'wallet-1', user: defaultUser } }
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/wallets'));

    vi.mocked(walletsApi.getWallet).mockRejectedValueOnce(new ApiError('server blew up', 500));
    rerender({ id: 'wallet-2', user: defaultUser });
    await waitFor(() => expect(result.current.error).toBe('server blew up'));
    expect(result.current.loading).toBe(false);

    vi.mocked(walletsApi.getWallet).mockRejectedValueOnce(new Error('boom'));
    rerender({ id: 'wallet-3', user: defaultUser });
    await waitFor(() => expect(result.current.error).toBe('Failed to load wallet'));
    expect(result.current.loading).toBe(false);
  });

  it('handles non-critical fetch failures, non-admin groups path, and visibility refresh', async () => {
    const nonAdminUser = { id: 'user-2', isAdmin: false } as any;
    vi.mocked(walletsApi.getWallet).mockResolvedValueOnce({
      ...baseWallet,
      type: 'single_sig',
      quorum: null,
      totalSigners: null,
    } as never);
    vi.mocked(bitcoinApi.getStatus).mockRejectedValueOnce(new Error('status fail'));
    vi.mocked(devicesApi.getDevices).mockRejectedValueOnce(new Error('devices fail'));
    vi.mocked(transactionsApi.getTransactions).mockRejectedValueOnce(new Error('tx fail'));
    vi.mocked(transactionsApi.getTransactionStats).mockRejectedValueOnce(new Error('stats fail'));
    vi.mocked(transactionsApi.getUTXOs).mockRejectedValueOnce(new Error('utxos fail'));
    vi.mocked(transactionsApi.getWalletPrivacy).mockRejectedValueOnce(new Error('privacy fail'));
    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValueOnce(new Error('summary fail'));
    vi.mocked(transactionsApi.getAddresses).mockRejectedValueOnce(new Error('addresses fail'));
    vi.mocked(draftsApi.getDrafts).mockResolvedValueOnce([] as never);
    vi.mocked(authApi.getUserGroups).mockRejectedValueOnce(new Error('groups fail'));
    vi.mocked(walletsApi.getWalletShareInfo).mockRejectedValueOnce(new Error('share fail'));

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: nonAdminUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.wallet?.quorum).toEqual({ m: 1, n: 1 });
    expect(mockRemoveNotificationsByType).toHaveBeenCalledWith('pending_drafts', 'wallet-1');

    await act(async () => {
      await result.current.loadMoreTransactions();
    });
    expect(transactionsApi.getTransactions).toHaveBeenCalledTimes(2);
    expect(result.current.transactions).toHaveLength(50);

    await act(async () => {
      await result.current.loadMoreUtxos();
    });
    expect(result.current.loadingMoreUtxos).toBe(false);

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledTimes(2));
  });

  it('returns early when required id or user is missing', async () => {
    const { result } = renderHook(() => useWalletData({ id: undefined, user: null }));
    await act(async () => {
      await result.current.fetchData();
      await result.current.loadMoreTransactions();
      await result.current.loadMoreUtxos();
    });

    expect(walletsApi.getWallet).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(true);
  });

  it('covers loadAddressSummary helper for present and missing summaries', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValueOnce({ totalAddresses: 7 } as never);
    await act(async () => {
      await result.current.loadAddressSummary('wallet-1');
    });
    expect(result.current.addressSummary?.totalAddresses).toBe(7);

    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValueOnce(new Error('summary missing'));
    await act(async () => {
      await result.current.loadAddressSummary('wallet-1');
    });
    expect(result.current.addressSummary?.totalAddresses).toBe(7);
  });

  it('appends addresses and uses limit fallback when address summary is unavailable', async () => {
    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValue(new Error('no summary'));
    vi.mocked(transactionsApi.getAddresses)
      .mockResolvedValueOnce(Array.from({ length: 25 }, (_, index) => makeAddress(`initial-${index}`)) as never)
      .mockResolvedValueOnce([makeAddress('next-page')] as never);

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addressSummary).toBeNull();

    await act(async () => {
      await result.current.loadAddresses('wallet-1', 2, 25, false);
    });

    expect(result.current.addresses.some(a => a.id === 'next-page')).toBe(true);
    expect(result.current.hasMoreAddresses).toBe(false);
  });

  it('appends addresses using total mode when address summary is available', async () => {
    // Default mock: getAddressSummary returns { totalAddresses: 2 }
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addressSummary?.totalAddresses).toBe(2);

    // Append (reset=false) with addressSummary present -- covers the truthy
    // branches of the ternaries at lines 162–163: addressSummary.totalAddresses / 'total'
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('append-1')] as never);
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 10, 1, false);
    });
    // offset should be updated from append, and hasMore should be false (offset 2 >= totalAddresses 2)
    expect(result.current.addresses.some(a => a.id === 'append-1')).toBe(true);
  });

  it('clears only the owning address loading state after reset and continuation failures', async () => {
    const view = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    vi.mocked(transactionsApi.getAddresses).mockRejectedValueOnce(new Error('reset failed'));
    await act(async () => {
      await view.result.current.loadAddresses('wallet-1', 25, 0, true);
    });
    expect(view.result.current.loadingAddresses).toBe(false);

    vi.mocked(transactionsApi.getAddresses).mockRejectedValueOnce(new Error('continuation failed'));
    await act(async () => {
      await view.result.current.loadAddresses(
        'wallet-1',
        25,
        view.result.current.addressOffset,
        false,
      );
    });
    expect(view.result.current.loadingAddresses).toBe(false);
    expect(view.result.current.addresses).toHaveLength(1);
  });

  it('resets addresses with addressSummary present: hasMore true and false', async () => {
    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addressSummary?.totalAddresses).toBe(2);

    // Reset with fewer addresses than totalAddresses: hasMore = true (1 < 2)
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('reset-1')] as never);
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 10, 0, true);
    });
    expect(result.current.hasMoreAddresses).toBe(true);

    // Reset with addresses >= totalAddresses: hasMore = false (2 < 2 is false)
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('r-a'), makeAddress('r-b')] as never);
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 10, 0, true);
    });
    expect(result.current.hasMoreAddresses).toBe(false);
  });

  it('loads addresses with null addressSummary (falsy branch)', async () => {
    // Force addressSummary to be null by rejecting the summary fetch
    vi.mocked(transactionsApi.getAddressSummary).mockRejectedValue(new Error('no summary'));
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([makeAddress('a1'), makeAddress('a2')] as never);

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addressSummary).toBeNull();

    // Reset path with null addressSummary — covers line 159 falsy branch
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('r1')] as never);
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 10, 0, true);
    });
    // Falls back to pageSize comparison: 1 === 10 is false, so hasMore = false
    expect(result.current.hasMoreAddresses).toBe(false);

    // Append path with null addressSummary — covers lines 162-163 falsy branches
    vi.mocked(transactionsApi.getAddresses).mockResolvedValueOnce([makeAddress('r2')] as never);
    await act(async () => {
      await result.current.loadAddresses('wallet-1', 10, 1, false);
    });
    expect(result.current.hasMoreAddresses).toBe(false);
  });

  it('uses singular pending-draft notification title and skips hidden-tab refresh', async () => {
    vi.mocked(draftsApi.getDrafts).mockResolvedValueOnce([{ id: 'draft-1' }] as never);

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockAddNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '1 pending draft',
        count: 1,
      })
    );

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(walletsApi.getWallet).toHaveBeenCalledTimes(1);
  });
});
