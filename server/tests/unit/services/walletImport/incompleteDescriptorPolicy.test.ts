import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prepareWalletImport: vi.fn(),
  importFromParsedData: vi.fn(),
}));

vi.mock('../../../../src/services/walletImport/prepareImport', () => ({
  prepareWalletImport: mocks.prepareWalletImport,
}));

vi.mock('../../../../src/services/walletImport/descriptorImport', () => ({
  importFromParsedData: mocks.importFromParsedData,
}));

import { importWallet } from '../../../../src/services/walletImport/walletImportService';

describe('wallet import descriptor policy boundary', () => {
  it('fails closed when descriptor preparation has no complete receive/change policy', async () => {
    mocks.prepareWalletImport.mockReturnValue({
      format: 'descriptor',
      parsed: {
        type: 'single_sig',
        scriptType: 'native_segwit',
        devices: [],
        network: 'mainnet',
        isChange: false,
      },
      network: 'mainnet',
    });

    await expect(importWallet('user-1', {
      data: 'descriptor-without-complete-policy',
      name: 'Unsafe import',
    })).rejects.toThrow(
      'Descriptor import did not produce a complete receive/change policy',
    );
    expect(mocks.importFromParsedData).not.toHaveBeenCalled();
  });
});
