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
  prepareChangeOutputs,
} from '../../../../src/services/bitcoin/transactions/outputBuilder';

const walletId = 'wallet-1';
const recipientScript = Buffer.from('00141111111111111111111111111111111111111111', 'hex');
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

  it('rejects an unavailable single change row', async () => {
    mocks.findNextUnusedChange.mockResolvedValueOnce(null);
    await expect(prepareChangeOutputs(walletId, 1)).rejects.toThrow(
      'No change address available',
    );
    expect(mocks.assertCanonicalAddressesForWallet).not.toHaveBeenCalled();
  });

  it('verifies every decoy change row before any PSBT output is added', async () => {
    const second = { ...change, id: 'change-1', index: 1, address: 'bc1qchange1' };
    mocks.findUnusedChangeAddresses.mockResolvedValueOnce([change, second]);
    mocks.generateDecoyAmounts.mockReturnValueOnce([6_000, 6_000]);
    const psbt = { addOutput: vi.fn() };
    const preparedChangeOutputs = await prepareChangeOutputs(walletId, 2);

    await buildAndAddOutputs(
      psbt as never,
      walletId,
      'bc1qrecipient',
      10_000,
      {
        utxos: [], totalAmount: 22_100, estimatedFee: 100, changeAmount: 12_000,
        changeOutputCount: 2,
      },
      546,
      false,
      preparedChangeOutputs,
      recipientScript,
      { enabled: true, count: 2 },
    );

    expect(mocks.assertCanonicalAddressesForWallet).toHaveBeenCalledWith(
      walletId, [change, second], 1,
    );
    expect(psbt.addOutput).toHaveBeenCalledTimes(3);
    expect(psbt.addOutput).toHaveBeenCalledWith({
      script: recipientScript,
      value: 10_000n,
    });
  });

  it('does not construct decoys below the two-output boundary even if selection metadata is inconsistent', async () => {
    mocks.generateDecoyAmounts.mockReturnValueOnce([6_000, 6_000]);
    const second = { ...change, id: 'change-1', index: 1, address: 'bc1qchange1' };
    const psbt = { addOutput: vi.fn() };

    const result = await buildAndAddOutputs(
      psbt as never,
      walletId,
      'bc1qrecipient',
      10_000,
      {
        utxos: [], totalAmount: 22_100, estimatedFee: 100, changeAmount: 12_000,
        changeOutputCount: 2,
      },
      546,
      false,
      [
        { address: change.address, scriptPubKey: Buffer.from(change.scriptPubKey, 'hex') },
        { address: second.address, scriptPubKey: Buffer.from(second.scriptPubKey, 'hex') },
      ],
      recipientScript,
      { enabled: true, count: 1 },
    );

    expect(result.decoyOutputsResult).toBeUndefined();
    expect(result.changeAddress).toBe(change.address);
    expect(psbt.addOutput).toHaveBeenCalledTimes(2);
    expect(mocks.generateDecoyAmounts).not.toHaveBeenCalled();
  });

  it('rejects missing prepared change evidence before output construction', async () => {
    const psbt = { addOutput: vi.fn() };
    await expect(buildAndAddOutputs(
      psbt as never,
      walletId,
      'bc1qrecipient',
      10_000,
      {
        utxos: [], totalAmount: 12_000, estimatedFee: 100, changeAmount: 1_900,
        changeOutputCount: 1,
      },
      546,
      false,
      [],
      recipientScript,
      { enabled: false, count: 1 },
    )).rejects.toThrow('No prepared change address available');
    expect(psbt.addOutput).not.toHaveBeenCalled();
  });

  it('rejects fewer prepared rows than the selected decoy output count', async () => {
    const psbt = { addOutput: vi.fn() };
    await expect(buildAndAddOutputs(
      psbt as never,
      walletId,
      'bc1qrecipient',
      10_000,
      {
        utxos: [], totalAmount: 22_100, estimatedFee: 100, changeAmount: 12_000,
        changeOutputCount: 2,
      },
      546,
      false,
      [{ address: change.address, scriptPubKey: Buffer.from(change.scriptPubKey, 'hex') }],
      recipientScript,
      { enabled: true, count: 2 },
    )).rejects.toThrow('Not enough change addresses for 2 decoy outputs');
  });

  it('rejects canonical change rows without script evidence', async () => {
    mocks.findNextUnusedChange.mockResolvedValueOnce({ ...change, scriptPubKey: null });
    await expect(prepareChangeOutputs(walletId, 1)).rejects.toThrow(
      'Canonical change address is missing script evidence',
    );
  });
});
