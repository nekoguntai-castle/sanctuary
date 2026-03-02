import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletData } from '../../../../components/WalletDetail/hooks/useWalletData';
import { ApiError } from '../../../../src/api/client';
import * as walletsApi from '../../../../src/api/wallets';
import * as transactionsApi from '../../../../src/api/transactions';
import * as devicesApi from '../../../../src/api/devices';
import * as bitcoinApi from '../../../../src/api/bitcoin';
import * as draftsApi from '../../../../src/api/drafts';
import * as authApi from '../../../../src/api/auth';
import * as adminApi from '../../../../src/api/admin';
import { useErrorHandler } from '../../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../../contexts/AppNotificationContext';

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

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

vi.mock('../../../../hooks/useErrorHandler', () => ({
  useErrorHandler: vi.fn(),
}));

vi.mock('../../../../contexts/AppNotificationContext', () => ({
  useAppNotifications: vi.fn(),
}));

vi.mock('../../../../components/WalletDetail/mappers', () => ({
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

const baseWallet = {
  id: 'wallet-1',
  name: 'Primary',
  type: 'multi_sig',
  network: 'mainnet',
  balance: 123456,
  scriptType: 'wsh',
  descriptor: "wsh(sortedmulti(2,[aabbccdd/48'/0'/0'/2']xpub...))",
  fingerprint: 'aabbccdd',
  quorum: '2',
  totalSigners: 3,
  lastSyncedAt: '2026-01-01T00:00:00.000Z',
  lastSyncStatus: 'success',
  syncInProgress: false,
  isShared: true,
  sharedWith: [],
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
      .mockResolvedValueOnce([makeAddress('initial')] as never)
      .mockResolvedValueOnce([makeAddress('next-page')] as never);

    const { result } = renderHook(() => useWalletData({ id: 'wallet-1', user: defaultUser }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addressSummary).toBeNull();

    await act(async () => {
      await result.current.loadAddresses('wallet-1', 2, 1, false);
    });

    expect(result.current.addresses.some(a => a.id === 'next-page')).toBe(true);
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
