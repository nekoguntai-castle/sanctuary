import { vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { mockElectrumClient, resetElectrumMocks } from '../../../mocks/electrum';

const { mockExecuteSyncPipeline } = vi.hoisted(() => ({
  mockExecuteSyncPipeline: vi.fn(),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  getNodeClient: vi.fn().mockResolvedValue(mockElectrumClient),
}));

vi.mock('../../../../src/services/bitcoin/sync', () => ({
  executeSyncPipeline: mockExecuteSyncPipeline,
  defaultSyncPhases: [],
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  walletLog: vi.fn(),
}));

import { syncWallet } from '../../../../src/services/bitcoin/blockchain';
import { getNodeClient } from '../../../../src/services/bitcoin/nodeClient';
import { walletLog } from '../../../../src/websocket/notifications';

describe('Blockchain syncWallet recursion', () => {
  beforeEach(() => {
    resetPrismaMocks();
    resetElectrumMocks();
    mockExecuteSyncPipeline.mockReset();
  });

  it('recursively syncs when new generated addresses contain transaction history', async () => {
    const walletId = 'wallet-recursive';
    const scanAddress = 'tb1qk2n44m4g4d8f67mz5fdtg6v9pfh2j08rj9j3xg';

    mockExecuteSyncPipeline
      .mockResolvedValueOnce({
        addresses: 2,
        transactions: 1,
        utxos: 1,
        stats: { newAddressesGenerated: 1 },
      })
      .mockResolvedValueOnce({
        addresses: 1,
        transactions: 2,
        utxos: 3,
        stats: { newAddressesGenerated: 0 },
      });

    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-1', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(
      new Map([[scanAddress, [{ tx_hash: 'a'.repeat(64), height: 100 }]]])
    );

    const result = await syncWallet(walletId);

    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(2);
    expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith([scanAddress]);
    expect(walletLog).toHaveBeenCalledWith(
      walletId,
      'info',
      'BLOCKCHAIN',
      expect.stringContaining('re-syncing')
    );
    expect(result).toEqual({
      addresses: 3,
      transactions: 3,
      utxos: 4,
    });
  });

  it('continues with original result when scanning generated addresses fails', async () => {
    const walletId = 'wallet-scan-error';
    const scanAddress = 'tb1q4f6x6a9wruy6s8hwj5em8z2s9yc03tf0m3etf8';
    const baseResult = {
      addresses: 4,
      transactions: 5,
      utxos: 6,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-2', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockRejectedValue(new Error('scan failed'));

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(1);
  });

  it('falls back to individual subscriptions when batch subscription fails', async () => {
    const walletId = 'wallet-subscribe-fallback';
    const scanAddress = 'tb1qv2m8n0h3l6j4z8u3n6n2s4m5k7y8p9q0r1t2u3';
    const baseResult = {
      addresses: 2,
      transactions: 0,
      utxos: 0,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-fallback', address: scanAddress, used: false },
    ]);
    mockElectrumClient.subscribeAddressBatch.mockRejectedValueOnce(new Error('batch failed'));
    mockElectrumClient.subscribeAddress.mockResolvedValueOnce(undefined);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map([[scanAddress, []]]));

    const result = await syncWallet(walletId);

    expect(mockElectrumClient.subscribeAddressBatch).toHaveBeenCalledWith([scanAddress]);
    expect(mockElectrumClient.subscribeAddress).toHaveBeenCalledWith(scanAddress);
    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
  });

  it('returns base result when generated-address scan is requested but wallet is missing', async () => {
    const walletId = 'wallet-missing';
    const baseResult = {
      addresses: 7,
      transactions: 8,
      utxos: 9,
      stats: { newAddressesGenerated: 2 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    expect(mockElectrumClient.getAddressHistoryBatch).not.toHaveBeenCalled();
  });

  it('uses mainnet fallback and returns base result when no generated addresses are found', async () => {
    const walletId = 'wallet-mainnet-fallback';
    const baseResult = {
      addresses: 5,
      transactions: 1,
      utxos: 2,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: '',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([]);

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(vi.mocked(getNodeClient)).toHaveBeenCalledWith('mainnet');
    expect(mockElectrumClient.getAddressHistoryBatch).not.toHaveBeenCalled();
  });

  it('does not recurse when generated addresses have no transaction history', async () => {
    const walletId = 'wallet-no-new-history';
    const scanAddress = 'tb1q6j8r8w8r0pg6j7mt6v4n3v0q0q7xg84n2n8l8t';
    const baseResult = {
      addresses: 3,
      transactions: 4,
      utxos: 5,
      stats: { newAddressesGenerated: 1 },
    };

    mockExecuteSyncPipeline.mockResolvedValueOnce(baseResult);
    mockPrismaClient.wallet.findUnique.mockResolvedValue({
      id: walletId,
      network: 'testnet',
    });
    mockPrismaClient.address.findMany.mockResolvedValue([
      { id: 'addr-empty-history', address: scanAddress, used: false },
    ]);
    mockElectrumClient.getAddressHistoryBatch.mockResolvedValue(new Map([[scanAddress, []]]));

    const result = await syncWallet(walletId);

    expect(result).toEqual({
      addresses: baseResult.addresses,
      transactions: baseResult.transactions,
      utxos: baseResult.utxos,
    });
    expect(mockExecuteSyncPipeline).toHaveBeenCalledTimes(1);
    expect(walletLog).not.toHaveBeenCalled();
  });
});
