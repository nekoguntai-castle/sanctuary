import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findNextUnusedChange: vi.fn(),
  findUnusedChangeAddresses: vi.fn(),
  assertCanonicalAddressesForWallet: vi.fn(),
  generateDecoyAmounts: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  addressRepository: {
    findNextUnusedChange: mocks.findNextUnusedChange,
    findUnusedChangeAddresses: mocks.findUnusedChangeAddresses,
  },
}));

vi.mock('../../../../src/services/wallet/canonicalAddressValidation', () => ({
  assertCanonicalAddressesForWallet: mocks.assertCanonicalAddressesForWallet,
}));

vi.mock('../../../../src/services/bitcoin/psbtBuilder', () => ({
  generateDecoyAmounts: mocks.generateDecoyAmounts,
}));

vi.mock('../../../../src/services/bitcoin/secureRandom', () => ({
  shuffleInPlace: vi.fn(),
}));

import {
  buildAndAddOutputs,
  findChangeAddress,
} from '../../../../src/services/bitcoin/transactions/outputBuilder';

const walletId = 'wallet-1';
const change = {
  id: 'change-0', walletId, address: 'bc1qchange', derivationPath: "m/84'/0'/0'/1/0",
  index: 0, branch: 1, coordinateVersion: 1,
  canonicalPolicyId: 'single-sig-native-segwit-bip84-v1', canonicalPolicyVersion: 1,
  scriptPubKey: '00140000000000000000000000000000000000000000', used: false,
};

describe('canonical change output selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCanonicalAddressesForWallet.mockResolvedValue(undefined);
  });

  it('verifies the single change row before returning its destination', async () => {
    mocks.findNextUnusedChange.mockResolvedValueOnce(change);
    await expect(findChangeAddress(walletId)).resolves.toBe(change.address);
    expect(mocks.assertCanonicalAddressesForWallet).toHaveBeenCalledWith(walletId, [change], 1);
  });

  it('does not return a single change destination when re-derivation fails', async () => {
    mocks.findNextUnusedChange.mockResolvedValueOnce(change);
    mocks.assertCanonicalAddressesForWallet.mockRejectedValueOnce(new Error('script drift'));
    await expect(findChangeAddress(walletId)).rejects.toThrow('script drift');
  });

  it('verifies every decoy change row before any PSBT output is added', async () => {
    const second = { ...change, id: 'change-1', index: 1, address: 'bc1qchange1' };
    mocks.findUnusedChangeAddresses.mockResolvedValueOnce([change, second]);
    mocks.generateDecoyAmounts.mockReturnValueOnce([6_000, 6_000]);
    const psbt = { addOutput: vi.fn() };

    await buildAndAddOutputs(
      psbt as never,
      walletId,
      'bc1qrecipient',
      10_000,
      { utxos: [], totalAmount: 22_100, estimatedFee: 100, changeAmount: 12_000 },
      546,
      false,
      0,
      { enabled: true, count: 2 },
    );

    expect(mocks.assertCanonicalAddressesForWallet).toHaveBeenCalledWith(
      walletId, [change, second], 1,
    );
    expect(psbt.addOutput).toHaveBeenCalledTimes(3);
  });
});
