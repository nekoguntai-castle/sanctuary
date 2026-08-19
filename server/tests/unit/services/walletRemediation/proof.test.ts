import { describe, expect, it } from 'vitest';
import {
  AUDIT_FIXTURE_CHANGE,
  AUDIT_FIXTURE_RECEIVE,
  AUDIT_FIXTURE_SOURCE,
  AUDIT_FIXTURE_XPUB,
  provenAuditSnapshot,
} from '../../../fixtures/walletSafetyAuditFixture';
import { buildWalletRemediationDocument } from '../../../../src/services/walletRemediation/proof';
import type { WalletRemediationSnapshot } from '../../../../src/services/walletRemediation/types';

function legacySnapshot(): WalletRemediationSnapshot {
  const fixture = provenAuditSnapshot();
  const wallet = fixture.wallets[0];
  return {
    wallet: {
      ...wallet,
      descriptorPolicyVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    },
    signers: [{
      id: 'wallet-link-1',
      walletId: wallet.id,
      deviceId: 'device-1',
      deviceAccountId: null,
      signerIndex: null,
      signerBindingVersion: null,
      signerFingerprint: null,
      signerXpub: null,
      signerDerivationPath: null,
      signerPurpose: null,
      signerScriptType: null,
      deviceFingerprint: 'aabbccdd',
      accountId: 'account-1',
      accountPurpose: 'single_sig',
      accountScriptType: 'native_segwit',
      accountDerivationPath: "m/84'/1'/0'",
      accountXpub: AUDIT_FIXTURE_XPUB,
    }],
    addresses: fixture.addresses.map((address) => ({
      ...address,
      branch: null,
      coordinateVersion: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
      scriptPubKey: null,
    })),
    ownerUserIds: ['owner-1'],
  };
}

/**
 * A wallet exactly as it exists after upgrading an install from <= v0.8.62.
 *
 * `legacySnapshot()` above is NOT this shape: it keeps changeDescriptor,
 * sourceDescriptor and descriptorSourceKind while nulling descriptorPolicyVersion,
 * which the wallets_descriptor_policy_complete_check CHECK constraint forbids, so no
 * such row can exist in Postgres. The production shape is wholly legacy-null, because
 * migrations 20260810010000 and 20260810020000 create these columns and rewrite no data.
 *
 * `pathNotation: 'h'` reproduces wallets whose stored derivationPath uses `h` hardened
 * markers — what pre-policy derivation persisted when the descriptor itself used them
 * (multisigDerivation.ts:49 stored firstKey.accountPath verbatim). Canonical derivation
 * always emits apostrophes (descriptorDerivation.ts:41-44), so these denote the identical
 * BIP32 path in a different notation.
 */
function legacyNullSnapshot(
  { pathNotation = 'apostrophe' }: { pathNotation?: 'apostrophe' | 'h' } = {},
): WalletRemediationSnapshot {
  const base = legacySnapshot();
  return {
    ...base,
    wallet: {
      ...base.wallet,
      changeDescriptor: null,
      descriptorPolicyVersion: null,
      descriptorSourceKind: null,
      sourceDescriptor: null,
      sourceChangeDescriptor: null,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      canonicalPolicyId: null,
      canonicalPolicyVersion: null,
    },
    addresses: base.addresses.map((address) => ({
      ...address,
      derivationPath: pathNotation === 'h'
        ? address.derivationPath.replace(/'/g, 'h')
        : address.derivationPath,
    })),
  };
}

function provenSnapshot(): WalletRemediationSnapshot {
  const fixture = provenAuditSnapshot();
  return {
    wallet: fixture.wallets[0],
    signers: fixture.signers.map(signer => ({
      ...signer,
      accountId: signer.deviceAccountId,
    })),
    addresses: fixture.addresses,
    ownerUserIds: ['owner-1'],
  };
}

describe('wallet remediation proof — legacy-null wallets (upgrade path)', () => {
  it('recovers a descriptor policy for a wallet whose rows predate the policy migrations', () => {
    const document = buildWalletRemediationDocument(legacyNullSnapshot());

    expect(document.blockers).toEqual([]);
    expect(document.eligible).toBe(true);
    expect(document.changes.map((change) => change.kind)).toEqual([
      'wallet_policy_recovery',
      'signer_binding',
      'address_coordinate',
      'address_coordinate',
    ]);
    expect(document.changes[0].proposed).toMatchObject({
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'recovered_legacy',
      changeDescriptor: AUDIT_FIXTURE_CHANGE,
      sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
    });
    // The immutable columns must never appear in a recovery patch.
    expect(document.changes[0].proposed).not.toHaveProperty('descriptor');
    expect(document.changes[0].proposed).not.toHaveProperty('fingerprint');
    expect(document.proof.recoveryStatus).toBe('recovery-proven');
  });

  it('recovers a wallet whose stored derivation paths use h hardened notation', () => {
    // Same BIP32 coordinates, different notation. The address and scriptPubKey still
    // have to match byte-for-byte; only the path label differs.
    const document = buildWalletRemediationDocument(legacyNullSnapshot({ pathNotation: 'h' }));

    expect(document.blockers).toEqual([]);
    expect(document.eligible).toBe(true);
    expect(document.changes.filter((change) => change.kind === 'address_coordinate')).toHaveLength(2);
  });

  it('re-proves an already-recovered wallet with no further changes', () => {
    // The post-apply convergence check re-runs this proof against the written row. A
    // recovered wallet has exactly one source token, so it must be rebuilt as a recovery;
    // falling through to the multipath expander (whose only trigger is a null
    // sourceChangeDescriptor) throws on its fixed-branch token and the approval that just
    // succeeded would be rolled back.
    const base = legacyNullSnapshot();
    const applied: WalletRemediationSnapshot = {
      ...base,
      wallet: {
        ...base.wallet,
        descriptorPolicyVersion: 1,
        descriptorSourceKind: 'recovered_legacy',
        changeDescriptor: AUDIT_FIXTURE_CHANGE,
        sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
        canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
        canonicalPolicyVersion: 1,
      },
      signers: base.signers.map((signer) => ({
        ...signer,
        deviceAccountId: signer.accountId,
        signerIndex: 0,
        signerBindingVersion: 1,
        signerFingerprint: signer.deviceFingerprint,
        signerXpub: signer.accountXpub,
        signerDerivationPath: signer.accountDerivationPath,
        signerPurpose: signer.accountPurpose,
        signerScriptType: signer.accountScriptType,
      })),
      addresses: provenAuditSnapshot().addresses,
    };

    const document = buildWalletRemediationDocument(applied);

    expect(document.blockers).toEqual([]);
    expect(document.eligible).toBe(true);
    expect(document.changes).toEqual([]);
  });

  it('does not rewrite the stored derivation path when recovering', () => {
    const document = buildWalletRemediationDocument(legacyNullSnapshot({ pathNotation: 'h' }));

    const coordinateChanges = document.changes.filter((c) => c.kind === 'address_coordinate');
    // Guard against passing vacuously while the wallet is still blocked.
    expect(coordinateChanges).toHaveLength(2);
    for (const change of coordinateChanges) {
      expect(change.proposed).not.toHaveProperty('derivationPath');
      expect(change.proposed).not.toHaveProperty('address');
    }
  });
});

describe('wallet remediation proof', () => {
  it('proposes only null proof metadata while preserving descriptors, paths, addresses, and scripts', () => {
    const snapshot = legacySnapshot();
    const document = buildWalletRemediationDocument(snapshot);

    expect(document.eligible).toBe(true);
    expect(document.blockers).toEqual([]);
    expect(document.changes.map((change) => change.kind)).toEqual([
      'wallet_policy',
      'signer_binding',
      'address_coordinate',
      'address_coordinate',
    ]);
    expect(document.changes).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ proposed: expect.objectContaining({
        descriptor: expect.anything(),
        changeDescriptor: expect.anything(),
        address: expect.anything(),
        derivationPath: expect.anything(),
        index: expect.anything(),
      }) }),
    ]));
    expect(document.proof).toMatchObject({
      addressCount: 2,
      unchangedAddressCount: 2,
      scriptPubKeyCount: 2,
      unchangedScriptPubKeyCount: 2,
      recoveryStatus: 'recovery-proven', signingStatus: 'not-tested',
    });
  });

  it.each([
    ['wrong descriptor path', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].accountDerivationPath = "m/84'/1'/7'";
    }, 'signer.binding_ambiguous'],
    ['wrong device fingerprint', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].deviceFingerprint = 'deadbeef';
    }, 'signer.binding_ambiguous'],
    ['wrong xpub bytes', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].accountXpub = 'not-an-xpub';
    }, 'signer.binding_ambiguous'],
    ['cross-network wallet', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.network = 'mainnet';
    }, 'signer.binding_ambiguous'],
    ['changed stored path', (snapshot: WalletRemediationSnapshot) => {
      snapshot.addresses[0].derivationPath = "m/84'/1'/0'/1/0";
    }, 'address.proof_ambiguous'],
    ['changed stored address', (snapshot: WalletRemediationSnapshot) => {
      snapshot.addresses[0].address = snapshot.addresses[1].address;
    }, 'address.proof_ambiguous'],
  ])('blocks %s without returning a patch', (_label, mutate, code) => {
    const snapshot = legacySnapshot();
    mutate(snapshot);
    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(false);
    expect(document.changes).toEqual([]);
    expect(document.blockers.map((item) => item.code)).toContain(code);
  });

  it('does not fall back to another account on the linked device', () => {
    const snapshot = legacySnapshot();
    snapshot.signers.unshift({
      ...snapshot.signers[0],
      accountId: 'wrong-account',
      accountDerivationPath: "m/84'/1'/1'",
    });
    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(true);
    expect(document.changes.find((change) => change.kind === 'signer_binding')?.proposed)
      .toMatchObject({ deviceAccountId: 'account-1' });
  });

  it('blocks zero-address and ordered multisig wallets', () => {
    const zero = legacySnapshot();
    zero.addresses = [];
    expect(buildWalletRemediationDocument(zero).blockers.map(({ code }) => code))
      .toContain('address.zero_addresses');

    const ordered = legacySnapshot();
    ordered.wallet.type = 'multi_sig';
    ordered.wallet.descriptor = AUDIT_FIXTURE_RECEIVE.replace('wpkh(', 'wsh(multi(1,');
    ordered.wallet.changeDescriptor = AUDIT_FIXTURE_CHANGE.replace('wpkh(', 'wsh(multi(1,');
    ordered.wallet.sourceDescriptor = AUDIT_FIXTURE_SOURCE.replace('wpkh(', 'wsh(multi(1,');
    expect(buildWalletRemediationDocument(ordered).blockers.map(({ code }) => code))
      .toContain('policy.ordered_multisig_unsupported');
  });

  it.each([
    ['missing descriptor provenance', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.sourceDescriptor = null;
    }, 'descriptor.provenance_missing'],
    ['unsupported wallet identity', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.type = 'unsupported' as never;
    }, 'policy.unsupported'],
    ['legacy multisig', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.type = 'multi_sig';
      snapshot.wallet.scriptType = 'legacy';
    }, 'policy.multisig_unsupported'],
    ['source and active descriptor mismatch', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.descriptor = snapshot.wallet.changeDescriptor;
    }, 'descriptor.provenance_unproven'],
    // A wallet that already has a change descriptor must still reproduce it exactly; only
    // a legacy-null wallet is allowed to have one derived for it.
    ['active change descriptor mismatch', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.changeDescriptor = snapshot.wallet.descriptor;
    }, 'descriptor.provenance_unproven'],
    ['descriptor wrapper and policy mismatch', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.scriptType = 'nested_segwit';
    }, 'descriptor.provenance_unproven'],
    ['wallet fingerprint order mismatch', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.fingerprint = 'deadbeef';
    }, 'descriptor.provenance_unproven'],
    ['existing wallet metadata conflict', (snapshot: WalletRemediationSnapshot) => {
      snapshot.wallet.canonicalPolicyId = 'wrong-policy';
    }, 'descriptor.provenance_unproven'],
    ['stored signer index conflict', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].signerIndex = 7;
    }, 'signer.binding_ambiguous'],
    ['missing signer account evidence', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].accountPurpose = null;
    }, 'signer.binding_ambiguous'],
    ['conflicting linked account', (snapshot: WalletRemediationSnapshot) => {
      snapshot.signers[0].deviceAccountId = 'another-account';
    }, 'signer.binding_ambiguous'],
  ])('blocks %s and emits no mutable patch', (_label, mutate, code) => {
    const snapshot = legacySnapshot();
    mutate(snapshot);
    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(false);
    expect(document.changes).toEqual([]);
    expect(document.blockers.map(item => item.code)).toContain(code);
  });

  it('accepts an exact generated descriptor pair as provenance', () => {
    const snapshot = legacySnapshot();
    snapshot.wallet.sourceDescriptor = snapshot.wallet.descriptor;
    snapshot.wallet.sourceChangeDescriptor = snapshot.wallet.changeDescriptor;
    snapshot.wallet.descriptorSourceKind = 'generated_pair';

    expect(buildWalletRemediationDocument(snapshot).eligible).toBe(true);
  });

  it('accepts an exact imported descriptor pair and emits no patch for already-proven metadata', () => {
    const snapshot = provenSnapshot();
    snapshot.wallet.sourceDescriptor = snapshot.wallet.descriptor;
    snapshot.wallet.sourceChangeDescriptor = snapshot.wallet.changeDescriptor;
    snapshot.wallet.descriptorSourceKind = 'imported_pair';

    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(true);
    expect(document.changes).toEqual([]);
  });

  it('blocks a descriptor whose signer count does not match wallet links', () => {
    const snapshot = legacySnapshot();
    snapshot.signers = [];

    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(false);
    expect(document.blockers.map(item => item.code)).toContain('signer.binding_ambiguous');
  });

  it('blocks wallets beyond the reviewed address limit', () => {
    const snapshot = legacySnapshot();
    snapshot.addresses = Array.from({ length: 5_001 }, (_, index) => ({
      ...snapshot.addresses[0],
      id: `address-${index}`,
    }));

    const document = buildWalletRemediationDocument(snapshot);
    expect(document.eligible).toBe(false);
    expect(document.blockers.map(item => item.code)).toContain('address.limit_exceeded');
    expect(document.changes).toEqual([]);
  });
});
