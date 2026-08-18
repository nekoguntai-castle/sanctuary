import { describe, expect, it } from 'vitest';
import { CANONICAL_ADDRESS_COORDINATE_VERSION } from '@sanctuary/shared/constants/walletPolicy';
import {
  assertPersistedCanonicalPolicy,
  canonicalPolicyIdentity,
  hasCanonicalPolicyIdentity,
  hasCompleteCanonicalAddressEvidence,
  requireCanonicalWalletPolicy,
} from '../../../../src/services/wallet/canonicalPolicy';

describe('canonical wallet policy identity', () => {
  it('rejects unknown wallet and script identity values before registry lookup', () => {
    expect(() => requireCanonicalWalletPolicy('unknown', 'native_segwit'))
      .toThrow('Unsupported wallet policy identity');
    expect(() => requireCanonicalWalletPolicy('single_sig', 'unknown'))
      .toThrow('Unsupported wallet policy identity');
  });

  it('rejects a valid identity pair that has no canonical registry policy', () => {
    expect(() => requireCanonicalWalletPolicy('multi_sig', 'legacy'))
      .toThrow('Unsupported wallet policy identity');
  });

  it('returns and binds the stable registry identity', () => {
    const policy = requireCanonicalWalletPolicy('single_sig', 'native_segwit');
    const identity = canonicalPolicyIdentity(policy);

    expect(identity).toEqual({
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
    });
    expect(assertPersistedCanonicalPolicy({
      type: 'single_sig',
      scriptType: 'native_segwit',
      ...identity,
    })).toBe(policy);
  });

  it('rejects missing and mismatched persisted identity', () => {
    expect(() => assertPersistedCanonicalPolicy({
      type: 'single_sig',
      scriptType: 'native_segwit',
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    })).toThrow('Wallet canonical policy identity is missing or inconsistent');
  });

  it('requires every canonical address evidence field and accepts both branches', () => {
    const complete = {
      branch: 0,
      coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      scriptPubKey: '00140000000000000000000000000000000000000000',
    };
    expect(hasCompleteCanonicalAddressEvidence(complete)).toBe(true);
    expect(hasCompleteCanonicalAddressEvidence({ ...complete, branch: 1 })).toBe(true);
    for (const incomplete of [
      { ...complete, branch: 2 },
      { ...complete, coordinateVersion: null },
      { ...complete, canonicalPolicyVersion: null },
      { ...complete, canonicalPolicyId: 'unknown-policy' },
      { ...complete, scriptPubKey: null },
      { ...complete, scriptPubKey: 'ABCDEF' },
      { ...complete, scriptPubKey: 'abc' },
    ]) {
      expect(hasCompleteCanonicalAddressEvidence(incomplete)).toBe(false);
    }
  });

  it('detects whether a wallet opted into canonical address evidence', () => {
    // Legacy rows from before the canonical-evidence migrations: nothing to validate.
    expect(hasCanonicalPolicyIdentity({
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    })).toBe(false);

    expect(hasCanonicalPolicyIdentity({
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
    })).toBe(true);

    // Half-populated identities are unreachable under the CHECK constraint but
    // must fail closed rather than read as "never opted in".
    expect(hasCanonicalPolicyIdentity({
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: null,
    })).toBe(true);
    expect(hasCanonicalPolicyIdentity({
      canonicalPolicyId: null,
      canonicalPolicyVersion: 1,
    })).toBe(true);
  });
});
