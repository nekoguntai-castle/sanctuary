import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertWalletHardwareCapabilityById: vi.fn(),
  findWalletById: vi.fn(),
  buildCanonicalAddressEvidence: vi.fn(),
}));

vi.mock('../../../src/services/hardwareWalletCapabilities', () => ({
  assertWalletHardwareCapabilityById: mocks.assertWalletHardwareCapabilityById,
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: { findById: mocks.findWalletById },
}));

vi.mock('../../../src/services/wallet/addressGeneration', () => ({
  buildCanonicalAddressEvidence: mocks.buildCanonicalAddressEvidence,
}));

import {
  assertFreshReceiveAddressSafeForDisplay,
  assertUnusedAddressesSafeForDisplay,
} from '../../../src/services/addressDisplaySafety';

const walletId = 'wallet-1';
const canonicalUnused = {
  walletId,
  address: 'bc1qcanonical',
  derivationPath: "m/84'/0'/0'/0/0",
  index: 0,
  used: false,
  branch: 0,
  coordinateVersion: 1,
  canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
  canonicalPolicyVersion: 1,
  scriptPubKey: '00140000000000000000000000000000000000000000',
};
const wallet = {
  id: walletId,
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  descriptor: 'receive-descriptor',
  changeDescriptor: 'change-descriptor',
  canonicalPolicyId: canonicalUnused.canonicalPolicyId,
  canonicalPolicyVersion: canonicalUnused.canonicalPolicyVersion,
};

describe('unused address display safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertWalletHardwareCapabilityById.mockResolvedValue(undefined);
    mocks.findWalletById.mockResolvedValue(wallet);
    mocks.buildCanonicalAddressEvidence.mockReturnValue({ ...canonicalUnused, used: false });
  });

  it('preserves used history without requiring a hardware display capability', async () => {
    await expect(assertUnusedAddressesSafeForDisplay(walletId, [
      { ...canonicalUnused, used: true },
    ])).resolves.toBeUndefined();
    expect(mocks.assertWalletHardwareCapabilityById).not.toHaveBeenCalled();
  });

  it('allows canonical unused evidence only after the display capability passes', async () => {
    await expect(assertUnusedAddressesSafeForDisplay(walletId, [canonicalUnused]))
      .resolves.toBeUndefined();
    expect(mocks.assertWalletHardwareCapabilityById).toHaveBeenCalledWith(walletId, 'display');
  });

  it('propagates disabled target-hardware display failures', async () => {
    mocks.assertWalletHardwareCapabilityById.mockRejectedValueOnce(new Error('display disabled'));
    await expect(assertUnusedAddressesSafeForDisplay(walletId, [canonicalUnused]))
      .rejects.toThrow('display disabled');
  });

  it('propagates repository failures instead of disguising them as policy denials', async () => {
    mocks.findWalletById.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(assertUnusedAddressesSafeForDisplay(walletId, [canonicalUnused]))
      .rejects.toThrow('database unavailable');

    mocks.findWalletById.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(assertFreshReceiveAddressSafeForDisplay(walletId, canonicalUnused))
      .rejects.toThrow('database unavailable');
  });

  it('rejects legacy-null unused evidence after the hardware gate', async () => {
    await expect(assertUnusedAddressesSafeForDisplay(walletId, [{
      ...canonicalUnused,
      used: false,
      branch: null,
      coordinateVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
      scriptPubKey: null,
    }])).rejects.toMatchObject({ statusCode: 403 });
  });

  it('requires a fresh branch-zero canonical address for payment requests', async () => {
    await expect(assertFreshReceiveAddressSafeForDisplay(walletId, canonicalUnused))
      .resolves.toBeUndefined();
    expect(mocks.buildCanonicalAddressEvidence).toHaveBeenCalledWith(
      wallet.descriptor,
      wallet.changeDescriptor,
      wallet.network,
      {
        canonicalPolicyId: canonicalUnused.canonicalPolicyId,
        canonicalPolicyVersion: canonicalUnused.canonicalPolicyVersion,
      },
      0,
      0,
    );

    await expect(assertFreshReceiveAddressSafeForDisplay(walletId, {
      ...canonicalUnused, used: true,
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    ['legacy-null evidence', {
      branch: null,
      coordinateVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
      scriptPubKey: null,
    }],
    ['change branch', {
      branch: 1,
      derivationPath: "m/84'/0'/0'/1/0",
    }],
    ['stale policy identity', {
      canonicalPolicyId: 'single-sig-taproot-bip86-v1',
    }],
    ['address drift', { address: 'bc1qtampered' }],
    ['path drift', { derivationPath: "m/84'/0'/0'/0/1" }],
    ['script drift', { scriptPubKey: '0014deadbeef' }],
  ])('rejects exact Payjoin %s evidence through the real validator', async (_label, override) => {
    await expect(assertFreshReceiveAddressSafeForDisplay(walletId, {
      ...canonicalUnused,
      ...override,
    })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects exact Payjoin address reuse before hardware or derivation checks', async () => {
    await expect(assertFreshReceiveAddressSafeForDisplay(walletId, {
      ...canonicalUnused,
      used: true,
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.assertWalletHardwareCapabilityById).not.toHaveBeenCalled();
    expect(mocks.findWalletById).not.toHaveBeenCalled();
  });
});
