import { describe, expect, it } from 'vitest';
import {
  buildWalletSafetyAuditReport,
  walletSafetyAuditReportSchema,
} from '../../../../src/services/walletSafetyAudit';
import {
  AUDIT_FIXTURE_XPUB,
  provenAuditSnapshot,
  recoverableOrderedMultisigSnapshot,
} from '../../../fixtures/walletSafetyAuditFixture';
import { convertXpubToFormat } from '../../../../src/services/bitcoin/addressDerivation';
import bip32 from '../../../../src/services/bitcoin/bip32';
import * as bitcoin from 'bitcoinjs-lib';
import type { WalletSafetyRawSnapshot } from '../../../../src/services/walletSafetyAudit';
import { VERIFIED_MULTISIG_VECTORS } from '../../../fixtures/verified-address-vectors';

const GENERATED_AT = new Date('2026-08-09T12:00:00.000Z');

describe('wallet safety audit analyzer', () => {
  it('classifies only exact PR2A policy, address, and signer evidence as proven safe', () => {
    const report = buildWalletSafetyAuditReport(provenAuditSnapshot(), GENERATED_AT);
    expect(report.summary).toEqual({
      provenSafe: 1,
      unsupportedButRecoverable: 0,
      manualInvestigation: 0,
      findingCount: 0,
    });
    expect(report.wallets[0]).toMatchObject({
      walletId: 'audit-wallet-proven',
      classification: 'proven_safe',
      findings: [],
    });
    expect(walletSafetyAuditReportSchema.parse(report)).toEqual(report);
  });

  it('requires manual investigation for legacy ordered multisig without canonical coordinates', () => {
    const report = buildWalletSafetyAuditReport(recoverableOrderedMultisigSnapshot(), GENERATED_AT);
    expect(report.wallets[0]).toMatchObject({
      classification: 'manual_investigation',
      findings: [
        { id: 'address.policy_mismatch' },
        { id: 'descriptor.provenance_unproven' },
        { id: 'policy.ordered_multisig_unsupported' },
      ],
    });
  });

  it('does not call ordered multisig recoverable when the source change token is missing', () => {
    const snapshot = recoverableOrderedMultisigSnapshot();
    snapshot.wallets[0].sourceChangeDescriptor = null;
    const report = buildWalletSafetyAuditReport(snapshot, GENERATED_AT);
    expect(report.wallets[0].classification).toBe('manual_investigation');
    expect(report.wallets[0].findings).toEqual([
      { id: 'address.policy_mismatch' },
      { id: 'descriptor.provenance_unproven' },
      { id: 'policy.ordered_multisig_unsupported' },
    ]);
  });

  it('does not call ordered multisig recoverable when present source tokens mismatch runtime', () => {
    const snapshot = recoverableOrderedMultisigSnapshot();
    snapshot.wallets[0].sourceChangeDescriptor = snapshot.wallets[0].sourceDescriptor;
    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];
    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'descriptor.provenance_unproven' });
  });

  it('flags address and immutable signer drift without exposing values in findings', () => {
    const snapshot = provenAuditSnapshot();
    snapshot.addresses[0].address = snapshot.addresses[1].address;
    snapshot.addresses[1].derivationPath = "m/84'/1'/0'/0/0";
    snapshot.signers[0].accountXpub = 'tpub-drift';
    const report = buildWalletSafetyAuditReport(snapshot, GENERATED_AT);
    expect(report.wallets[0].classification).toBe('manual_investigation');
    expect(report.wallets[0].findings).toEqual([
      { id: 'address.path_inconsistent' },
      { id: 'address.policy_mismatch' },
      { id: 'signer.snapshot_mismatch' },
    ]);
    expect(report.wallets[0].findings.every((finding) => Object.keys(finding).length === 1)).toBe(true);
  });

  it('is deterministic for equivalent snapshots regardless of input row order', () => {
    const left = provenAuditSnapshot();
    const right = provenAuditSnapshot();
    right.addresses.reverse();
    const leftReport = buildWalletSafetyAuditReport(left, GENERATED_AT);
    const rightReport = buildWalletSafetyAuditReport(right, GENERATED_AT);
    expect(rightReport).toEqual(leftReport);
  });

  it('sorts multiple wallets and signer bindings deterministically', () => {
    const snapshot = provenAuditSnapshot();
    snapshot.wallets.unshift({
      ...snapshot.wallets[0],
      id: 'audit-wallet-a',
    });
    snapshot.signers.push(
      { ...snapshot.signers[0], id: 'signer-z', signerIndex: null },
      { ...snapshot.signers[0], id: 'signer-a', signerIndex: null },
    );

    const report = buildWalletSafetyAuditReport(snapshot, GENERATED_AT);

    expect(report.wallets.map((wallet) => wallet.walletId)).toEqual([
      'audit-wallet-a',
      'audit-wallet-proven',
    ]);
    expect(report.wallets[1].evidence.signers.map((signer) => signer.id)).toEqual([
      'audit-signer-proven',
      'signer-a',
      'signer-z',
    ]);
  });

  it('classifies empty-address and incomplete signer records for manual investigation', () => {
    const snapshot = provenAuditSnapshot();
    snapshot.addresses = [];
    snapshot.signers[0].deviceAccountId = null;
    snapshot.signers[0].accountXpub = null;
    const findings = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0].findings;
    expect(findings).toContainEqual({ id: 'address.zero_addresses' });
    expect(findings).toContainEqual({ id: 'signer.binding_incomplete' });
  });

  it('checks descriptor keys even when no hardware signer link exists', () => {
    const snapshot = provenAuditSnapshot();
    const vector = VERIFIED_MULTISIG_VECTORS.find(candidate => (
      candidate.scriptType === 'p2sh_p2wsh'
      && candidate.totalKeys === 3
      && candidate.network === 'testnet3'
    ))!;
    const keys = vector.xpubs.map((xpub, index) => (
      `[${['aabbccdd', 'eeff0011', '22334455'][index]}/48h/1h/0h/1h]${convertXpubToFormat(xpub, 'Upub')}`
    ));
    const descriptor = (branch: 0 | 1): string => (
      `sh(wsh(sortedmulti(2,${keys.map(key => `${key}/${branch}/*`).join(',')})))`
    );
    snapshot.signers = [];
    for (const wallet of snapshot.wallets) {
      wallet.descriptor = descriptor(0);
      wallet.changeDescriptor = descriptor(1);
      wallet.descriptorSourceKind = 'imported_pair';
      wallet.sourceDescriptor = descriptor(0);
      wallet.sourceChangeDescriptor = descriptor(1);
    }

    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];
    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'signer.xpub_version_mismatch' });
  });

  it('rejects descriptor origins whose declared account depth does not match the xpub', () => {
    const snapshot = provenAuditSnapshot();
    snapshot.signers = [];
    for (const wallet of snapshot.wallets) {
      wallet.descriptor = wallet.descriptor?.replace('84h/1h/0h', '84h/1h/0h/7h') ?? null;
      wallet.changeDescriptor = wallet.changeDescriptor?.replace('84h/1h/0h', '84h/1h/0h/7h') ?? null;
      wallet.sourceDescriptor = wallet.sourceDescriptor?.replace('84h/1h/0h', '84h/1h/0h/7h') ?? null;
    }
    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];
    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'descriptor.policy_inconsistent' });
  });

  it('does not accept an account-parent fingerprint as master identity evidence', () => {
    const snapshot = provenAuditSnapshot();
    const xpub = snapshot.signers[0].signerXpub as string;
    const parentFingerprint = bip32.fromBase58(xpub, bitcoin.networks.testnet)
      .parentFingerprint.toString(16).padStart(8, '0');
    snapshot.signers = [];
    for (const wallet of snapshot.wallets) {
      wallet.descriptor = wallet.descriptor?.replace(/aabbccdd/g, parentFingerprint) ?? null;
      wallet.changeDescriptor = wallet.changeDescriptor?.replace(/aabbccdd/g, parentFingerprint) ?? null;
      wallet.sourceDescriptor = wallet.sourceDescriptor?.replace(/aabbccdd/g, parentFingerprint) ?? null;
      wallet.fingerprint = parentFingerprint;
    }
    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];
    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'signer.fingerprint_parent_only' });
  });

  it('never classifies consistently non-hardened single-sig origins as proven safe', () => {
    const snapshot = provenAuditSnapshot();
    const replaceOrigin = (value: string | null) => value
      ?.replaceAll('84h/1h/0h', '84/1/0')
      .replaceAll("84'/1'/0'", '84/1/0') ?? null;
    const wallet = snapshot.wallets[0];
    wallet.descriptor = replaceOrigin(wallet.descriptor);
    wallet.changeDescriptor = replaceOrigin(wallet.changeDescriptor);
    wallet.sourceDescriptor = replaceOrigin(wallet.sourceDescriptor);
    for (const address of snapshot.addresses) {
      address.derivationPath = replaceOrigin(address.derivationPath) as string;
    }
    const signer = snapshot.signers[0];
    signer.signerDerivationPath = replaceOrigin(signer.signerDerivationPath);
    signer.deviceDerivationPath = replaceOrigin(signer.deviceDerivationPath);
    signer.accountDerivationPath = replaceOrigin(signer.accountDerivationPath);

    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];

    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'descriptor.policy_inconsistent' });
    expect(audited.findings).toContainEqual({ id: 'signer.snapshot_mismatch' });
  });

  it('rejects non-hardened BIP48 origins before recovery classification', () => {
    const snapshot = recoverableOrderedMultisigSnapshot();
    const replaceOrigin = (value: string | null) => value?.replaceAll(
      "48'/1'/0'/2'",
      '48/1/0/2',
    ).replace('wsh(multi(', 'wsh(sortedmulti(') ?? null;
    const wallet = snapshot.wallets[0];
    wallet.descriptor = replaceOrigin(wallet.descriptor);
    wallet.changeDescriptor = replaceOrigin(wallet.changeDescriptor);
    wallet.sourceDescriptor = replaceOrigin(wallet.sourceDescriptor);
    wallet.sourceChangeDescriptor = replaceOrigin(wallet.sourceChangeDescriptor);
    wallet.descriptorSourceKind = 'generated_pair';
    wallet.descriptorPolicyVersion = 1;
    for (const address of snapshot.addresses) {
      address.derivationPath = replaceOrigin(address.derivationPath) as string;
    }

    const audited = buildWalletSafetyAuditReport(snapshot, GENERATED_AT).wallets[0];

    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: 'descriptor.policy_inconsistent' });
  });

  const anomalyCases: Array<{
    name: string;
    snapshot: () => WalletSafetyRawSnapshot;
    expectedFinding: string;
  }> = [
    {
      name: 'mixed receive branches',
      snapshot: () => {
        const snapshot = recoverableOrderedMultisigSnapshot();
        const mixed = snapshot.wallets[0].descriptor?.replace('/0/*,', '/1/*,') ?? null;
        snapshot.wallets[0].descriptor = mixed;
        snapshot.wallets[0].sourceDescriptor = mixed;
        return snapshot;
      },
      expectedFinding: 'descriptor.mixed_change_branches',
    },
    {
      name: 'legacy multisig',
      snapshot: () => {
        const snapshot = recoverableOrderedMultisigSnapshot();
        snapshot.wallets[0].scriptType = 'legacy';
        return snapshot;
      },
      expectedFinding: 'policy.legacy_multisig_unsupported',
    },
    {
      name: 'Taproot multisig',
      snapshot: () => {
        const snapshot = recoverableOrderedMultisigSnapshot();
        snapshot.wallets[0].scriptType = 'taproot';
        return snapshot;
      },
      expectedFinding: 'policy.taproot_multisig_unsupported',
    },
    {
      name: 'zero master fingerprint',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        snapshot.signers = [];
        const wallet = snapshot.wallets[0];
        wallet.descriptor = wallet.descriptor?.replace(/aabbccdd/g, '00000000') ?? null;
        wallet.changeDescriptor = wallet.changeDescriptor?.replace(/aabbccdd/g, '00000000') ?? null;
        wallet.sourceDescriptor = wallet.sourceDescriptor?.replace(/aabbccdd/g, '00000000') ?? null;
        wallet.fingerprint = '00000000';
        return snapshot;
      },
      expectedFinding: 'descriptor.policy_inconsistent',
    },
    {
      name: 'missing signer fingerprint',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        snapshot.signers[0].signerFingerprint = null;
        return snapshot;
      },
      expectedFinding: 'signer.binding_incomplete',
    },
    {
      name: 'invalid signer xpub',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        snapshot.signers[0].signerXpub = 'tpub-invalid';
        snapshot.signers[0].accountXpub = 'tpub-invalid';
        snapshot.signers[0].deviceXpub = 'tpub-invalid';
        return snapshot;
      },
      expectedFinding: 'signer.xpub_invalid',
    },
    {
      name: 'network-mismatched signer xpub',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        const mainnetXpub = convertXpubToFormat(AUDIT_FIXTURE_XPUB, 'xpub');
        snapshot.signers[0].signerXpub = mainnetXpub;
        snapshot.signers[0].accountXpub = mainnetXpub;
        snapshot.signers[0].deviceXpub = mainnetXpub;
        return snapshot;
      },
      expectedFinding: 'signer.xpub_network_mismatch',
    },
    {
      name: 'ambiguous signer order',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        snapshot.signers[0].signerIndex = 1;
        return snapshot;
      },
      expectedFinding: 'signer.binding_ambiguous',
    },
    {
      name: 'missing account link',
      snapshot: () => {
        const snapshot = provenAuditSnapshot();
        snapshot.signers[0].deviceAccountId = null;
        return snapshot;
      },
      expectedFinding: 'signer.binding_incomplete',
    },
  ];

  it.each(anomalyCases)('keeps $name out of proven-safe results', ({ snapshot, expectedFinding }) => {
    const audited = buildWalletSafetyAuditReport(snapshot(), GENERATED_AT).wallets[0];
    expect(audited.classification).toBe('manual_investigation');
    expect(audited.findings).toContainEqual({ id: expectedFinding });
  });
});
