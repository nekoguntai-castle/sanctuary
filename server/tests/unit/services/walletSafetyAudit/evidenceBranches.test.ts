import { describe, expect, it } from 'vitest';
import { convertXpubToFormat } from '../../../../src/services/bitcoin/addressDerivation';
import { parseDescriptorForImport } from '../../../../src/services/bitcoin/descriptorParser';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';
import type { ParsedDescriptor } from '../../../../src/services/bitcoin/descriptorParser/types';
import { inspectAddressEvidence } from '../../../../src/services/walletSafetyAudit/addressEvidence';
import { inspectDescriptorEvidence } from '../../../../src/services/walletSafetyAudit/descriptorEvidence';
import { inspectExtendedKeyEvidence } from '../../../../src/services/walletSafetyAudit/extendedKeyEvidence';
import {
  networkCoinType,
  snapshotMatchesCurrentAccount,
  snapshotMatchesDescriptor,
  snapshotMatchesWallet,
} from '../../../../src/services/walletSafetyAudit/signerEvidence';
import type {
  RawAuditAddress,
  RawAuditWallet,
} from '../../../../src/services/walletSafetyAudit/schema';
import {
  AUDIT_FIXTURE_CHANGE,
  AUDIT_FIXTURE_RECEIVE,
  AUDIT_FIXTURE_XPUB,
  provenAuditSnapshot,
  recoverableOrderedMultisigSnapshot,
} from '../../../fixtures/walletSafetyAuditFixture';

function provenEvidence() {
  const snapshot = provenAuditSnapshot();
  return {
    wallet: snapshot.wallets[0],
    address: snapshot.addresses[0],
    signer: snapshot.signers[0],
    receive: parseDescriptorForImport(snapshot.wallets[0].descriptor as string),
    change: parseDescriptorForImport(snapshot.wallets[0].changeDescriptor as string),
  };
}

function findingsForAddress(
  wallet: RawAuditWallet,
  address: RawAuditAddress,
  receive: ParsedDescriptor,
  change: ParsedDescriptor,
) {
  return inspectAddressEvidence(wallet, [address], receive, change);
}

describe('wallet safety audit evidence boundaries', () => {
  it('fails closed for malformed paths, unsupported networks, absent descriptors, and derivation errors', () => {
    const { wallet, address, receive, change } = provenEvidence();

    expect(findingsForAddress(
      wallet,
      { ...address, derivationPath: 'not-a-derivation-path' },
      receive,
      change,
    )).toEqual(['address.policy_mismatch', 'address.path_inconsistent']);

    expect(findingsForAddress(
      { ...wallet, network: 'unknown-network' },
      address,
      receive,
      change,
    )).toEqual(['address.policy_mismatch', 'address.path_inconsistent']);

    const changeAddress = provenAuditSnapshot().addresses[1];
    expect(findingsForAddress(
      { ...wallet, changeDescriptor: null },
      changeAddress,
      receive,
      change,
    )).toEqual(['address.policy_mismatch', 'address.path_inconsistent']);

    expect(findingsForAddress(
      { ...wallet, descriptor: 'not-a-descriptor' },
      address,
      receive,
      change,
    )).toEqual(['address.policy_mismatch', 'address.path_inconsistent']);
  });

  it('rejects address paths when parsed signer origins disagree or are empty', () => {
    const { wallet, address, receive, change } = provenEvidence();
    const conflictingOrigins: ParsedDescriptor = {
      ...receive,
      devices: [
        ...receive.devices,
        { ...receive.devices[0], fingerprint: '11223344', derivationPath: "m/84'/1'/1'" },
      ],
    };
    expect(findingsForAddress(wallet, address, conflictingOrigins, change)).toEqual([
      'address.path_inconsistent',
    ]);

    const emptyOrigin: ParsedDescriptor = {
      ...receive,
      devices: [{ ...receive.devices[0], derivationPath: '' }],
    };
    expect(findingsForAddress(wallet, address, emptyOrigin, change)).toEqual([
      'address.path_inconsistent',
    ]);
  });

  it('accepts exact generated-pair and imported-pair descriptor policies', () => {
    for (const sourceKind of ['generated_pair', 'imported_pair'] as const) {
      const wallet = provenAuditSnapshot().wallets[0];
      Object.assign(wallet, {
        descriptorSourceKind: sourceKind,
        sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
        sourceChangeDescriptor: AUDIT_FIXTURE_CHANGE,
      });

      expect(inspectDescriptorEvidence(wallet).findings).toEqual([]);
    }
  });

  it('validates checksummed recovery provenance without losing exact source tokens', () => {
    const wallet = recoverableOrderedMultisigSnapshot().wallets[0];
    const receiveChecksum = computeDescriptorChecksum(wallet.sourceDescriptor as string);
    const changeChecksum = computeDescriptorChecksum(wallet.sourceChangeDescriptor as string);
    wallet.sourceDescriptor = `${wallet.sourceDescriptor}#${receiveChecksum}`;
    wallet.sourceChangeDescriptor = `${wallet.sourceChangeDescriptor}#${changeChecksum}`;
    wallet.sourceDescriptorChecksum = receiveChecksum;
    wallet.sourceChangeDescriptorChecksum = changeChecksum;

    expect(inspectDescriptorEvidence(wallet).findings).toEqual([
      'policy.ordered_multisig_unsupported',
    ]);
  });

  it('accepts a mainnet imported pair with mainnet extended-key evidence', () => {
    const wallet = provenAuditSnapshot().wallets[0];
    const mainnetXpub = convertXpubToFormat(AUDIT_FIXTURE_XPUB, 'xpub');
    const receive = AUDIT_FIXTURE_RECEIVE
      .replace(AUDIT_FIXTURE_XPUB, mainnetXpub)
      .replace("84'/1'/0'", "84'/0'/0'");
    const change = AUDIT_FIXTURE_CHANGE
      .replace(AUDIT_FIXTURE_XPUB, mainnetXpub)
      .replace("84'/1'/0'", "84'/0'/0'");
    Object.assign(wallet, {
      network: 'mainnet',
      descriptor: receive,
      changeDescriptor: change,
      descriptorSourceKind: 'imported_pair',
      sourceDescriptor: receive,
      sourceChangeDescriptor: change,
    });

    expect(inspectDescriptorEvidence(wallet).findings).toEqual([]);
  });

  it('fails closed for missing, unknown, malformed, and inconsistent descriptor policy evidence', () => {
    const missingSource = provenAuditSnapshot().wallets[0];
    missingSource.sourceDescriptor = null;
    expect(inspectDescriptorEvidence(missingSource).findings).toContain(
      'descriptor.provenance_unproven',
    );

    for (const descriptorSourceKind of ['generated_pair', 'imported_pair']) {
      const missingChange = provenAuditSnapshot().wallets[0];
      missingChange.descriptorSourceKind = descriptorSourceKind;
      missingChange.sourceDescriptor = AUDIT_FIXTURE_RECEIVE;
      missingChange.sourceChangeDescriptor = null;
      expect(inspectDescriptorEvidence(missingChange).findings).toContain(
        'descriptor.provenance_unproven',
      );
    }

    const unknownSourceKind = provenAuditSnapshot().wallets[0];
    unknownSourceKind.descriptorSourceKind = 'unknown';
    expect(inspectDescriptorEvidence(unknownSourceKind).findings).toContain(
      'descriptor.provenance_unproven',
    );

    const staleGeneratedPolicy = provenAuditSnapshot().wallets[0];
    Object.assign(staleGeneratedPolicy, {
      descriptorSourceKind: 'generated_pair',
      sourceDescriptor: AUDIT_FIXTURE_RECEIVE,
      sourceChangeDescriptor: AUDIT_FIXTURE_CHANGE,
      descriptorPolicyVersion: null,
    });
    expect(inspectDescriptorEvidence(staleGeneratedPolicy).findings).toContain(
      'descriptor.policy_inconsistent',
    );

    const malformedSource = provenAuditSnapshot().wallets[0];
    malformedSource.sourceDescriptor = 'not-a-descriptor';
    expect(inspectDescriptorEvidence(malformedSource).findings).toContain(
      'descriptor.policy_inconsistent',
    );

    const missingRuntime = provenAuditSnapshot().wallets[0];
    missingRuntime.descriptor = null;
    expect(inspectDescriptorEvidence(missingRuntime)).toMatchObject({
      findings: expect.arrayContaining(['descriptor.policy_inconsistent']),
      receive: null,
      change: null,
    });

    const invalidRuntime = provenAuditSnapshot().wallets[0];
    invalidRuntime.descriptor = 'not-a-descriptor';
    expect(inspectDescriptorEvidence(invalidRuntime)).toMatchObject({
      findings: expect.arrayContaining(['descriptor.policy_inconsistent']),
      receive: null,
      change: null,
    });

    const unknownNetwork = provenAuditSnapshot().wallets[0];
    unknownNetwork.network = 'unknown-network';
    expect(inspectDescriptorEvidence(unknownNetwork).findings).toContain(
      'descriptor.policy_inconsistent',
    );
  });

  it('distinguishes unknown network and extended-key version families', () => {
    expect(inspectExtendedKeyEvidence({
      xpub: AUDIT_FIXTURE_XPUB,
      fingerprint: 'aabbccdd',
      derivationPath: "m/84'/1'/0'",
      walletNetwork: 'unknown-network',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
    })).toContain('signer.xpub_network_mismatch');

    expect(inspectExtendedKeyEvidence({
      xpub: 'unknown-extended-key',
      fingerprint: 'aabbccdd',
      derivationPath: "m/84'/1'/0'",
      walletNetwork: 'testnet3',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
    })).toContain('signer.xpub_network_mismatch');

    expect(inspectExtendedKeyEvidence({
      xpub: 'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc',
      fingerprint: 'aabbccdd',
      derivationPath: "m/84'/1'/0'",
      walletNetwork: 'testnet3',
      walletType: 'single_sig',
      scriptType: 'nested_segwit',
    })).toContain('signer.xpub_version_mismatch');
  });

  it('handles signer identity boundary values without treating them as valid bindings', () => {
    const { wallet, signer, receive } = provenEvidence();
    expect(networkCoinType('mainnet')).toBe(0);
    expect(networkCoinType('unknown-network')).toBeNull();
    expect(snapshotMatchesCurrentAccount({
      ...signer,
      signerFingerprint: null,
    })).toBe(false);
    expect(snapshotMatchesDescriptor({
      ...signer,
      signerIndex: null,
    }, receive)).toBe(false);
    expect(snapshotMatchesWallet({
      ...signer,
      signerDerivationPath: "m/84'/1'/2147483648'",
    }, wallet)).toBe(false);
    expect(snapshotMatchesWallet({
      ...signer,
      signerPurpose: 'multisig',
    }, { ...wallet, type: 'multi_sig' })).toBe(false);
  });
});
