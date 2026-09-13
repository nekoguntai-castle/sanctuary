import { describe, expect, it, vi } from 'vitest';

import { fetchAuxiliaryData } from '../../../../src/components/WalletDetail/hooks/walletDataLoaders';

/**
 * Unlike walletDataLoaders.branches.test.ts, this file does NOT mock
 * `src/api/bitcoin` — it mocks the HTTP boundary (`src/api/client`) instead,
 * so the real `bitcoinApi.getStatus` runs and its legacy-network
 * normalization is observable on the outgoing request.
 *
 * Regression: `fetchAuxiliaryData` forwarded `apiWallet.network` to
 * `getStatus` via `as Parameters<typeof bitcoinApi.getStatus>[0]`, a cast
 * (#1067) that silenced the type error which would have caught a legacy
 * 'testnet' wallet network reaching `/bitcoin/status` unnormalized (a 400).
 */
const mockGet = vi.fn();

vi.mock('../../../../src/api/client', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args),
    post: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../../../../src/components/WalletDetail/mappers', () => ({
  formatApiTransaction: vi.fn(() => ({ id: 'tx' })),
  formatApiUtxo: vi.fn(() => ({ id: 'utxo' })),
}));

vi.mock('../../../../src/components/WalletDetail/hooks/walletDataFormatters', () => ({
  formatWalletFromApi: vi.fn((wallet: unknown) => wallet),
  formatDevicesForWallet: vi.fn(() => []),
}));

describe('fetchAuxiliaryData with a legacy testnet wallet network', () => {
  it('requests the testnet3 explorer when the wallet network is the legacy "testnet"', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/bitcoin/status') {
        return Promise.resolve({ connected: true, explorerUrl: 'https://explorer.example/testnet3' });
      }
      return Promise.resolve({});
    });

    const aux = await fetchAuxiliaryData(
      'wallet-1',
      { id: 'wallet-1', network: 'testnet' } as any,
      'user-1',
      { tx: 5, utxo: 5, address: 5 },
    );

    expect(mockGet).toHaveBeenCalledWith('/bitcoin/status', { network: 'testnet3' });
    expect(aux.explorerUrl).toBe('https://explorer.example/testnet3');
  });
});
