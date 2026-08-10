import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findWalletById: vi.fn(),
  buildCanonicalAddressEvidence: vi.fn(),
}));

vi.mock('../../../../src/repositories', () => ({
  walletRepository: { findById: mocks.findWalletById },
}));

vi.mock('../../../../src/services/wallet/addressGeneration', () => ({
  buildCanonicalAddressEvidence: mocks.buildCanonicalAddressEvidence,
}));

import {
  CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE,
  assertCanonicalAddressesForWallet,
  assertCanonicalAddressesMatchWallet,
  CanonicalAddressValidationError,
} from '../../../../src/services/wallet/canonicalAddressValidation';

const policyId = 'single-sig-native-segwit-bip84-v1';
const wallet = {
  id: 'wallet-1', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet',
  descriptor: 'receive', changeDescriptor: 'change',
  canonicalPolicyId: policyId, canonicalPolicyVersion: 1,
};
const address = {
  walletId: 'wallet-1', address: 'bc1qcanonical', derivationPath: "m/84'/0'/0'/0/0",
  index: 0, branch: 0, coordinateVersion: 1, canonicalPolicyId: policyId,
  canonicalPolicyVersion: 1, scriptPubKey: '00140000000000000000000000000000000000000000',
};

describe('canonical address to wallet verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findWalletById.mockResolvedValue(wallet);
    mocks.buildCanonicalAddressEvidence.mockReturnValue({ ...address, used: false });
  });

  it('accepts exact wallet-bound evidence and the legacy testnet alias', () => {
    expect(() => assertCanonicalAddressesMatchWallet(wallet as never, [address] as never, 0))
      .not.toThrow();
    expect(() => assertCanonicalAddressesMatchWallet(
      { ...wallet, network: 'testnet' } as never,
      [address] as never,
    )).not.toThrow();
  });

  it.each([
    ['wallet id', { walletId: 'wallet-2' }],
    ['branch', { branch: 1 }],
    ['coordinate version', { coordinateVersion: 2 }],
    ['policy id', { canonicalPolicyId: 'single-sig-taproot-bip86-v1' }],
    ['policy version', { canonicalPolicyVersion: 2 }],
  ])('rejects a complete-looking row with wrong %s', (_label, override) => {
    expect(() => assertCanonicalAddressesMatchWallet(
      wallet as never,
      [{ ...address, ...override }] as never,
      0,
    )).toThrow(/not eligible/i);
  });

  it.each([
    ['address', { address: 'bc1qtampered' }],
    ['path', { derivationPath: "m/84'/0'/0'/0/1" }],
    ['script', { scriptPubKey: '0014deadbeef' }],
  ])('rejects persisted %s drift after re-derivation', (_label, override) => {
    expect(() => assertCanonicalAddressesMatchWallet(
      wallet as never,
      [{ ...address, ...override }] as never,
    )).toThrow(/does not match/i);
  });

  it('rejects incomplete wallet policy, unknown networks, and derivation failures', () => {
    expect(() => assertCanonicalAddressesMatchWallet(
      { ...wallet, descriptor: null } as never, [address] as never,
    )).toThrow(/descriptor policy is incomplete/i);
    expect(() => assertCanonicalAddressesMatchWallet(
      { ...wallet, network: 'unknown' } as never, [address] as never,
    )).toThrow(/network is not canonical/i);
    mocks.buildCanonicalAddressEvidence.mockImplementationOnce(() => { throw new Error('derive failed'); });
    expect(() => assertCanonicalAddressesMatchWallet(wallet as never, [address] as never))
      .toThrow(CanonicalAddressValidationError);
  });

  it('classifies expected policy errors without masking unexpected failures', () => {
    expect(() => assertCanonicalAddressesMatchWallet(
      { ...wallet, canonicalPolicyVersion: 2 } as never,
      [address] as never,
    )).toThrow(CanonicalAddressValidationError);

    const unexpected = new Error('policy lookup failed unexpectedly');
    const brokenWallet = {
      ...wallet,
      get type() {
        throw unexpected;
      },
    };
    expect(() => assertCanonicalAddressesMatchWallet(
      brokenWallet as never,
      [address] as never,
    )).toThrow(unexpected);
  });

  it('loads the wallet once, fails closed when absent, and skips empty batches', async () => {
    await expect(assertCanonicalAddressesForWallet('wallet-1', [address] as never, 0))
      .resolves.toBeUndefined();
    expect(mocks.findWalletById).toHaveBeenCalledTimes(1);

    mocks.findWalletById.mockResolvedValueOnce(null);
    await expect(assertCanonicalAddressesForWallet('missing', [address] as never))
      .rejects.toThrow(/not found/i);

    vi.clearAllMocks();
    await expect(assertCanonicalAddressesForWallet('wallet-1', []))
      .resolves.toBeUndefined();
    expect(mocks.findWalletById).not.toHaveBeenCalled();
  });

  it('yields between bounded re-derivation chunks while retaining one wallet snapshot', async () => {
    let eventLoopYielded = false;
    setImmediate(() => {
      eventLoopYielded = true;
    });
    mocks.buildCanonicalAddressEvidence.mockImplementation(() => {
      if (mocks.buildCanonicalAddressEvidence.mock.calls.length
        > CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE) {
        expect(eventLoopYielded).toBe(true);
      }
      return { ...address, used: false };
    });
    const rows = Array.from(
      { length: CANONICAL_ADDRESS_VALIDATION_CHUNK_SIZE + 1 },
      () => ({ ...address }),
    );

    await expect(assertCanonicalAddressesForWallet('wallet-1', rows as never, 0))
      .resolves.toBeUndefined();

    expect(mocks.findWalletById).toHaveBeenCalledTimes(1);
    expect(mocks.buildCanonicalAddressEvidence).toHaveBeenCalledTimes(rows.length);
  });
});
