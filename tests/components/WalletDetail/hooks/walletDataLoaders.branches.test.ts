import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAuxiliaryData,
  loadAddressPage,
  loadGroups,
} from '../../../../components/WalletDetail/hooks/walletDataLoaders';
import * as transactionsApi from '../../../../src/api/transactions';
import * as devicesApi from '../../../../src/api/devices';
import * as bitcoinApi from '../../../../src/api/bitcoin';
import * as draftsApi from '../../../../src/api/drafts';
import * as authApi from '../../../../src/api/auth';
import * as adminApi from '../../../../src/api/admin';

vi.mock('../../../../src/api/transactions', () => ({
  getAddressSummary: vi.fn(),
  getAddresses: vi.fn(),
  getUTXOs: vi.fn(),
  getTransactions: vi.fn(),
  getTransactionStats: vi.fn(),
  getWalletPrivacy: vi.fn(),
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

vi.mock('../../../../components/WalletDetail/mappers', () => ({
  formatApiTransaction: vi.fn((tx: any) => ({ id: tx.id || tx.txid || 'tx' })),
  formatApiUtxo: vi.fn((utxo: any) => ({ id: utxo.id || `${utxo.txid || 'tx'}:${utxo.vout || 0}` })),
}));

vi.mock('../../../../components/WalletDetail/hooks/walletDataFormatters', () => ({
  formatWalletFromApi: vi.fn((wallet: any) => wallet),
  formatDevicesForWallet: vi.fn(() => [{ id: 'device-1' }]),
}));

vi.mock('../../../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../../../utils/errorHandler', () => ({
  logError: vi.fn(),
}));

describe('walletDataLoaders branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: 'https://mempool.space' } as any);
    vi.mocked(devicesApi.getDevices).mockResolvedValue([] as any);
    vi.mocked(transactionsApi.getTransactions).mockResolvedValue([] as any);
    vi.mocked(transactionsApi.getTransactionStats).mockResolvedValue({ count: 0 } as any);
    vi.mocked(transactionsApi.getUTXOs).mockResolvedValue({
      utxos: [],
      count: 0,
      totalBalance: 0,
    } as any);
    vi.mocked(transactionsApi.getWalletPrivacy).mockResolvedValue({
      utxos: [],
      summary: null,
    } as any);
    vi.mocked(transactionsApi.getAddressSummary).mockResolvedValue({ totalAddresses: 0 } as any);
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([] as any);
    vi.mocked(draftsApi.getDrafts).mockResolvedValue([] as any);
    vi.mocked(authApi.getUserGroups).mockResolvedValue([] as any);
    vi.mocked(adminApi.getGroups).mockResolvedValue([] as any);
  });

  it('maps address labels/balance fallbacks when API fields are missing', async () => {
    vi.mocked(transactionsApi.getAddresses).mockResolvedValue([
      {
        id: 'addr-1',
        address: 'bc1qfirst',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
        balance: undefined,
        isChange: false,
      },
      {
        id: 'addr-2',
        address: 'bc1qsecond',
        derivationPath: "m/84'/0'/0'/0/1",
        index: 1,
        used: true,
        balance: 1234,
        isChange: false,
        labels: ['known'],
      },
    ] as any);

    const addresses = await loadAddressPage('wallet-1', 0, 10);

    expect(addresses[0]).toMatchObject({
      id: 'addr-1',
      balance: 0,
      labels: [],
      walletId: 'wallet-1',
    });
    expect(addresses[1]).toMatchObject({
      id: 'addr-2',
      balance: 1234,
      labels: ['known'],
      walletId: 'wallet-1',
    });
  });

  it('normalizes missing explorer URL to null during auxiliary load', async () => {
    vi.mocked(bitcoinApi.getStatus).mockResolvedValue({ explorerUrl: undefined } as any);

    const aux = await fetchAuxiliaryData(
      'wallet-1',
      { id: 'wallet-1' } as any,
      'user-1',
      { tx: 5, utxo: 5, address: 5 },
    );

    expect(aux.explorerUrl).toBeNull();
    expect(aux.devices).toEqual([{ id: 'device-1' }]);
  });

  it('maps admin groups with optional description/members fallbacks', async () => {
    vi.mocked(adminApi.getGroups).mockResolvedValue([
      {
        id: 'group-1',
        name: 'Operators',
        description: '',
        members: undefined,
      },
    ] as any);

    const groups = await loadGroups({ isAdmin: true } as any);

    expect(groups).toEqual([
      {
        id: 'group-1',
        name: 'Operators',
        description: undefined,
        memberCount: 0,
        memberIds: [],
      },
    ]);
  });
});
