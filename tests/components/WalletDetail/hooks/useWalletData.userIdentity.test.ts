/**
 * Non-regression tests for P2 `user-preference-write--user-keyed-effects-refetch`
 * (wallet detail site, found by the plan's enumeration).
 *
 * Bug: the initial-load and visibility effects keyed on the whole `user`
 * object. A preference write (theme toggle, network alignment, any slider)
 * gave `user` a new identity, so an open wallet ran a full non-refresh fetch:
 * it showed its loading state and dropped every loaded "Load more" page.
 *
 * Fix: the effects key on `user.id` and `user.isAdmin`; the visibility handler
 * calls through `drainFetchRef` so it always uses the latest `user`.
 */
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
  getAllUTXOs: vi.fn(),
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

type TestUser = { id: string; isAdmin: boolean; preferences?: Record<string, unknown> };
const nonAdmin: TestUser = { id: 'user-1', isAdmin: false };

function renderWalletData(user: TestUser) {
  const loadingLog: boolean[] = [];
  const hook = renderHook(
    ({ id, user: hookUser }: { id: string; user: TestUser }) => {
      const result = useWalletData({ id, user: hookUser as never });
      loadingLog.push(result.loading);
      return result;
    },
    { initialProps: { id: 'wallet-1', user } },
  );
  return { ...hook, loadingLog };
}

describe('useWalletData user identity keys', () => {
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
    vi.mocked(transactionsApi.getAllUTXOs).mockResolvedValue({
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

  afterEach(() => {
    if (originalVisibilityDescriptor) {
      Object.defineProperty(document, 'visibilityState', originalVisibilityDescriptor);
    }
  });

  it('keeps the loaded wallet and pages when only preferences change', async () => {
    const { result, rerender, loadingLog } = renderWalletData(nonAdmin);
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(authApi.getUserGroups).toHaveBeenCalledTimes(1));
    const mark = loadingLog.length;

    rerender({ id: 'wallet-1', user: { ...nonAdmin, preferences: { darkMode: true } } });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    expect(walletsApi.getWallet).toHaveBeenCalledTimes(1);
    expect(loadingLog.slice(mark)).not.toContain(true);
    expect(result.current.loading).toBe(false);
  });

  it('refetches when the signed-in user id changes', async () => {
    const { result, rerender } = renderWalletData(nonAdmin);
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ id: 'wallet-1', user: { ...nonAdmin, id: 'user-2' } });

    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledTimes(2));
  });

  it('refetches groups when admin status changes for the same id', async () => {
    const { result, rerender } = renderWalletData(nonAdmin);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(adminApi.getGroups).not.toHaveBeenCalled();

    rerender({ id: 'wallet-1', user: { ...nonAdmin, isAdmin: true } });

    await waitFor(() => expect(adminApi.getGroups).toHaveBeenCalledTimes(1));
  });

  it('a visibility refresh uses the latest user after a same-id admin change', async () => {
    const { result, rerender, loadingLog } = renderWalletData(nonAdmin);
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ id: 'wallet-1', user: { ...nonAdmin, isAdmin: true } });
    await waitFor(() => expect(adminApi.getGroups).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.clearAllMocks();
    const mark = loadingLog.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });

    await waitFor(() => expect(walletsApi.getWallet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(adminApi.getGroups).toHaveBeenCalledTimes(1));
    expect(authApi.getUserGroups).not.toHaveBeenCalled();
    expect(loadingLog.slice(mark)).not.toContain(true);
  });
});
