import { describe, expect, it } from 'vitest';
import { CANONICAL_ADDRESS_COORDINATE_VERSION } from '@sanctuary/shared/constants/walletPolicy';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { convertXpubToFormat } from '../../../../src/services/bitcoin/addressDerivation';
import { parseDescriptorForImport } from '../../../../src/services/bitcoin/descriptorParser';
import { computeDescriptorChecksum } from '../../../../src/services/bitcoin/descriptorParser/checksum';
import type { ParsedDescriptor } from '../../../../src/services/bitcoin/descriptorParser/types';
import { inspectAddressEvidence } from '../../../../src/services/walletSafetyAudit/addressEvidence';
import { buildWalletSafetyAuditReport } from '../../../../src/services/walletSafetyAudit/analyzer';
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
  WalletSafetyRawSnapshot,
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

const hardened = (index: number): number => index + 0x80000000;

function fixtureAccountXpub(seedByte: number, path: number[]): string {
  let node = bip32.fromSeed(Buffer.alloc(32, seedByte), bitcoin.networks.testnet);
  for (const component of path) node = node.derive(hardened(component));
  return node.neutered().toBase58();
}

function canonicalAuditCase(kind: 'taproot' | 'nested-multisig' | 'native-multisig') {
  if (kind === 'taproot') {
    const xpub = fixtureAccountXpub(20, [86, 1, 0]);
    return {
      type: 'single_sig', scriptType: 'taproot', policyId: 'single-sig-taproot-bip86-v1',
      receive: `tr([aabbccdd/86'/1'/0']${xpub}/0/*)`,
      path: "m/86'/1'/0'/0/0",
      address: 'tb1pwpla8f7rlw9ueu4p6m6jmumv8mwvh04w6n59rh3mggp7c63r5ryqf0psvu',
      scriptPubKey: '5120707fd3a7c3fb8bccf2a1d6f52df36c3edccbbeaed4e851de3b4203ec6a23a0c8',
    } as const;
  }
  const nested = kind === 'nested-multisig';
  const script = nested ? 1 : 2;
  const seeds = nested ? [7, 8] : [21, 22];
  const xpubs = seeds.map((seed) => fixtureAccountXpub(seed, [48, 1, 0, script]));
  const inner = `sortedmulti(2,[aabbccdd/48'/1'/0'/${script}']${xpubs[0]}/0/*,[eeff0011/48'/1'/0'/${script}']${xpubs[1]}/0/*)`;
  return {
    type: 'multi_sig',
    scriptType: nested ? 'nested_segwit' : 'native_segwit',
    policyId: nested
      ? 'multisig-nested-segwit-bip48-1-v1'
      : 'multisig-native-segwit-bip48-2-v1',
    receive: nested ? `sh(wsh(${inner}))` : `wsh(${inner})`,
    path: `m/48'/1'/0'/${script}'/0/0`,
    address: nested
      ? '2N37zM2Rvw9dy2XZak4GbVb29nogvtnGA4D'
      : 'tb1qdrxxmgywjwz4j060kaamm4rjz30wkpqq6kc6zdnd3gyxnrn2sl5qrwdnev',
    scriptPubKey: nested
      ? 'a9146c52f540602b2d51eb9175c6aafcc4707325ed4487'
      : '002068cc6da08e9385593f4fb77bbdd472145eeb0400d5b1a1366d8a08698e6a87e8',
  } as const;
}

function canonicalAuditSnapshot(
  kind: 'taproot' | 'nested-multisig' | 'native-multisig',
): WalletSafetyRawSnapshot {
  const fixture = canonicalAuditCase(kind);
  const changeDescriptor = fixture.receive.replaceAll('/0/*', '/1/*');
  const parsed = parseDescriptorForImport(fixture.receive);
  const purpose = fixture.type === 'multi_sig' ? 'multisig' : 'single_sig';
  const walletId = `audit-wallet-${kind}`;

  return {
    wallets: [{
      id: walletId,
      type: fixture.type,
      scriptType: fixture.scriptType,
      network: 'testnet3',
      quorum: fixture.type === 'multi_sig' ? 2 : null,
      totalSigners: fixture.type === 'multi_sig' ? 2 : null,
      descriptor: fixture.receive,
      changeDescriptor,
      descriptorPolicyVersion: 1,
      descriptorSourceKind: 'generated_pair',
      sourceDescriptor: fixture.receive,
      sourceChangeDescriptor: changeDescriptor,
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: parsed.devices.map((device) => device.fingerprint).join('-'),
      canonicalPolicyId: fixture.policyId,
      canonicalPolicyVersion: 1,
    }],
    addresses: [{
      id: `audit-address-${kind}`,
      walletId,
      address: fixture.address,
      derivationPath: fixture.path,
      index: 0,
      branch: 0,
      coordinateVersion: CANONICAL_ADDRESS_COORDINATE_VERSION,
      canonicalPolicyId: fixture.policyId,
      canonicalPolicyVersion: 1,
      scriptPubKey: fixture.scriptPubKey,
    }],
    signers: parsed.devices.map((device, signerIndex) => ({
      id: `audit-signer-${kind}-${signerIndex}`,
      walletId,
      deviceId: `audit-device-${kind}-${signerIndex}`,
      deviceAccountId: `audit-account-${kind}-${signerIndex}`,
      signerIndex,
      signerBindingVersion: 1,
      signerFingerprint: device.fingerprint,
      signerXpub: device.xpub,
      signerDerivationPath: device.derivationPath,
      signerPurpose: purpose,
      signerScriptType: fixture.scriptType,
      deviceType: 'test',
      deviceFingerprint: device.fingerprint,
      deviceDerivationPath: device.derivationPath,
      deviceXpub: device.xpub,
      accountPurpose: purpose,
      accountScriptType: fixture.scriptType,
      accountDerivationPath: device.derivationPath,
      accountXpub: device.xpub,
    })),
  };
}

describe('wallet safety audit evidence boundaries', () => {
  it.each(['taproot', 'nested-multisig', 'native-multisig'] as const)(
    'classifies complete %s canonical evidence and every persisted drift dimension end to end',
    (kind) => {
      const snapshot = canonicalAuditSnapshot(kind);
      const report = buildWalletSafetyAuditReport(snapshot);
      expect(report.summary).toEqual({
        provenSafe: 1,
        unsupportedButRecoverable: 0,
        manualInvestigation: 0,
        findingCount: 0,
      });
      expect(report.wallets[0].classification).toBe('proven_safe');

      const mutations: Array<(value: WalletSafetyRawSnapshot) => void> = [
        (value) => { value.addresses[0].address += '-drift'; },
        (value) => { value.addresses[0].derivationPath = value.addresses[0].derivationPath.replace('/0/0', '/1/0'); },
        (value) => { value.addresses[0].scriptPubKey = '0014deadbeef'; },
        (value) => { value.addresses[0].canonicalPolicyId = 'single-sig-native-segwit-bip84-v1'; },
      ];
      for (const mutate of mutations) {
        const drifted = structuredClone(snapshot);
        mutate(drifted);
        const driftReport = buildWalletSafetyAuditReport(drifted);
        expect(driftReport.wallets[0].classification).toBe('manual_investigation');
        expect(driftReport.summary.manualInvestigation).toBe(1);
        expect(driftReport.summary.findingCount).toBeGreaterThan(0);
      }
    },
  );

  it.each(['taproot', 'nested-multisig', 'native-multisig'] as const)(
    'proves and detects literal address drift for the %s canonical policy',
    (kind) => {
      const fixture = canonicalAuditCase(kind);
      const base = provenAuditSnapshot();
      const wallet = {
        ...base.wallets[0],
        type: fixture.type,
        scriptType: fixture.scriptType,
        quorum: fixture.type === 'multi_sig' ? 2 : null,
        totalSigners: fixture.type === 'multi_sig' ? 2 : null,
        descriptor: fixture.receive,
        changeDescriptor: fixture.receive.replaceAll('/0/*', '/1/*'),
        canonicalPolicyId: fixture.policyId,
      };
      const address = {
        ...base.addresses[0],
        address: fixture.address,
        derivationPath: fixture.path,
        canonicalPolicyId: fixture.policyId,
        scriptPubKey: fixture.scriptPubKey,
      };
      const receive = parseDescriptorForImport(wallet.descriptor);
      const change = parseDescriptorForImport(wallet.changeDescriptor);

      expect(findingsForAddress(wallet, address, receive, change)).toEqual([]);
      expect(findingsForAddress(
        wallet,
        { ...address, address: `${address.address}-drift` },
        receive,
        change,
      )).toContain('address.policy_mismatch');
    },
  );

  it('fails closed for malformed paths, unsupported networks, absent descriptors, and derivation errors', () => {
    const { wallet, address, receive, change } = provenEvidence();

    expect(findingsForAddress(
      wallet,
      { ...address, derivationPath: 'not-a-derivation-path' },
      receive,
      change,
    )).toEqual(['address.path_inconsistent']);

    expect(findingsForAddress(
      { ...wallet, network: 'unknown-network' },
      address,
      receive,
      change,
    )).toEqual(['address.policy_mismatch']);

    const changeAddress = provenAuditSnapshot().addresses[1];
    expect(findingsForAddress(
      { ...wallet, changeDescriptor: null },
      changeAddress,
      receive,
      change,
    )).toEqual(['address.policy_mismatch']);

    expect(findingsForAddress(
      { ...wallet, descriptor: 'not-a-descriptor' },
      address,
      receive,
      change,
    )).toEqual(['address.policy_mismatch']);
  });

  it('reconstructs from the persisted descriptor rather than mutable parsed evidence', () => {
    const { wallet, address, receive, change } = provenEvidence();
    const conflictingOrigins: ParsedDescriptor = {
      ...receive,
      devices: [
        ...receive.devices,
        { ...receive.devices[0], fingerprint: '11223344', derivationPath: "m/84'/1'/1'" },
      ],
    };
    expect(findingsForAddress(wallet, address, conflictingOrigins, change)).toEqual([]);

    const emptyOrigin: ParsedDescriptor = {
      ...receive,
      devices: [{ ...receive.devices[0], derivationPath: '' }],
    };
    expect(findingsForAddress(wallet, address, emptyOrigin, change)).toEqual([]);
  });

  it('rejects a mutually consistent wallet/address policy identity that is not registry canonical', () => {
    const { wallet, address, receive, change } = provenEvidence();
    const wrongPolicyId = 'single-sig-native-segwit-unregistered-v1';

    expect(findingsForAddress(
      { ...wallet, canonicalPolicyId: wrongPolicyId },
      { ...address, canonicalPolicyId: wrongPolicyId },
      receive,
      change,
    )).toContain('address.policy_mismatch');
  });

  it('reports canonical script evidence drift and duplicate coordinates', () => {
    const { wallet, address, receive, change } = provenEvidence();
    expect(findingsForAddress(
      wallet,
      { ...address, scriptPubKey: '0014deadbeef' },
      receive,
      change,
    )).toContain('address.script_pubkey_mismatch');

    expect(inspectAddressEvidence(
      wallet,
      [address, { ...address, id: 'duplicate-coordinate' }],
      receive,
      change,
    )).toContain('address.path_inconsistent');
  });

  it('marks legacy address rows without canonical coordinates as unproven', () => {
    const { wallet, address, receive, change } = provenEvidence();
    expect(findingsForAddress(
      wallet,
      { ...address, coordinateVersion: null, branch: null },
      receive,
      change,
    )).toEqual(['address.coordinate_missing']);
  });

  it('fails closed before policy lookup for malformed wallet identity', () => {
    const { wallet, address, receive, change } = provenEvidence();
    expect(findingsForAddress(
      { ...wallet, type: 'unknown' },
      address,
      receive,
      change,
    )).toContain('address.policy_mismatch');
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
      'descriptor.provenance_unproven',
    ]);
  });

  it('rejects ordered-multisig recovery provenance when the branch policies differ', () => {
    const mutations = [
      (descriptor: string) => descriptor.replace('wsh(', 'sh(wsh(') + ')',
      (descriptor: string) => descriptor.replace('multi(2,', 'multi(1,'),
      (descriptor: string) => descriptor.replace("/48'/1'/0'/2']", "/48'/1'/1'/2']"),
      (descriptor: string) => descriptor.replace('eeff0011', 'deadbeef'),
      (descriptor: string) => descriptor.replace('tpubDFPt', 'tpubDEfob'),
    ];

    for (const mutate of mutations) {
      const wallet = recoverableOrderedMultisigSnapshot().wallets[0];
      const changed = mutate(wallet.changeDescriptor as string);
      wallet.changeDescriptor = changed;
      wallet.sourceChangeDescriptor = changed;
      expect(inspectDescriptorEvidence(wallet).findings).toContain(
        'descriptor.provenance_unproven',
      );
    }
  });

  it('accepts a mainnet imported pair with mainnet extended-key evidence', () => {
    const wallet = provenAuditSnapshot().wallets[0];
    const mainnetXpub = convertXpubToFormat(AUDIT_FIXTURE_XPUB, 'xpub');
    const receive = AUDIT_FIXTURE_RECEIVE
      .replace(AUDIT_FIXTURE_XPUB, mainnetXpub)
      .replace('84h/1h/0h', '84h/0h/0h');
    const change = AUDIT_FIXTURE_CHANGE
      .replace(AUDIT_FIXTURE_XPUB, mainnetXpub)
      .replace('84h/1h/0h', '84h/0h/0h');
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

  it('reports malformed fingerprints and extended keys at the wrong account depth', () => {
    expect(inspectExtendedKeyEvidence({
      xpub: AUDIT_FIXTURE_XPUB,
      fingerprint: 'not-hex',
      derivationPath: "m/84'/1'/0'",
      walletNetwork: 'testnet3',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
    })).toContain('signer.fingerprint_missing');

    expect(inspectExtendedKeyEvidence({
      xpub: AUDIT_FIXTURE_XPUB,
      fingerprint: 'aabbccdd',
      derivationPath: "m/84'/1'",
      walletNetwork: 'testnet3',
      walletType: 'single_sig',
      scriptType: 'native_segwit',
    })).toContain('signer.xpub_wrong_depth');
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
