import { beforeEach, describe, expect, it, vi } from 'vitest';
import './backupServiceTestHarness';
import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';
import { BackupService, type SanctuaryBackup } from '../../../../src/services/backupService';
import {
  LEGACY_TABLE_ORDER,
  MIGRATIONS,
} from '../../../../src/services/backupService/constants';
import { validateDescriptorPoliciesForRestore } from '../../../../src/services/backupService/validation';
import { migrationService } from '../../../../src/services/migrationService';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';

const XPUB = bip32.fromSeed(Buffer.alloc(32, 61), bitcoin.networks.bitcoin)
  .derivePath("m/84'/0'/0'")
  .neutered()
  .toBase58();
const RECEIVE = `wpkh([aabbccdd/84'/0'/0']${XPUB}/0/*)`;
const CHANGE = `wpkh([aabbccdd/84'/0'/0']${XPUB}/1/*)`;
const MULTIPATH = `wpkh([aabbccdd/84'/0'/0']${XPUB}/<0;1>/*)`;
const CANONICAL_RECEIVE = RECEIVE.replaceAll("'", 'h');
const CANONICAL_CHANGE = CHANGE.replaceAll("'", 'h');

const policyWallet = (
  sourceKind: 'generated_pair' | 'imported_pair' | 'imported_multipath',
) => ({
  id: `wallet-${sourceKind}`,
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'mainnet',
  quorum: null,
  totalSigners: null,
  descriptor: sourceKind === 'imported_multipath' ? CANONICAL_RECEIVE : RECEIVE,
  fingerprint: 'aabbccdd',
  changeDescriptor: sourceKind === 'imported_multipath' ? CANONICAL_CHANGE : CHANGE,
  descriptorPolicyVersion: 1,
  descriptorSourceKind: sourceKind,
  sourceDescriptor: sourceKind === 'imported_multipath' ? MULTIPATH : RECEIVE,
  sourceChangeDescriptor: sourceKind === 'imported_multipath' ? null : CHANGE,
  sourceDescriptorChecksum: null,
  sourceChangeDescriptorChecksum: null,
});

const legacyBackup = (): SanctuaryBackup => {
  const data: SanctuaryBackup['data'] = Object.fromEntries(
    LEGACY_TABLE_ORDER.map(table => [table, []]),
  );
  data.user = [{ id: 'admin-1', username: 'admin', isAdmin: true }];
  data.wallet = [{ id: 'wallet-legacy', descriptor: RECEIVE }];
  return {
    meta: {
      version: '1.0.0',
      appVersion: '0.8.62',
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      createdBy: 'admin',
      includesCache: false,
      recordCounts: {},
    },
    data,
  };
};

describe('backup descriptor policy restore preflight', () => {
  beforeEach(() => {
    resetPrismaMocks();
    vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(1);
  });

  it.each(['generated_pair', 'imported_pair', 'imported_multipath'] as const)(
    'accepts an exact %s policy',
    sourceKind => {
      const result = validateDescriptorPoliciesForRestore({
        wallet: [policyWallet(sourceKind)],
      });

      expect(result).toEqual({ issues: [], warnings: [] });
    },
  );

  it.each([
    [
      'incomplete policy',
      { ...policyWallet('generated_pair'), changeDescriptor: null },
      'incomplete versioned descriptor policy',
    ],
    [
      'mismatched canonical policy',
      { ...policyWallet('imported_pair'), descriptor: RECEIVE.replace('aabbccdd', '11223344') },
      'does not match its exact source evidence',
    ],
    [
      'unsupported policy version',
      { ...policyWallet('generated_pair'), descriptorPolicyVersion: 2 },
      'unsupported descriptor policy version 2',
    ],
  ])('rejects an %s', (_case, wallet, expectedIssue) => {
    const result = validateDescriptorPoliciesForRestore({ wallet: [wallet] });

    expect(result.warnings).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain(expectedIssue);
  });

  it('accepts a legacy descriptor row only with a quarantine warning', () => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{ id: 'wallet-legacy', descriptor: RECEIVE }],
    });

    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([
      '1 restored wallet(s) remain legacy-unverified and require remediation before funds-controlling use',
    ]);
  });

  it('rejects a legacy row containing partial versioned policy fields', () => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{ id: 'wallet-partial', descriptor: RECEIVE, changeDescriptor: CHANGE }],
    });

    expect(result).toEqual({
      issues: ['Wallet wallet-partial has descriptor policy fields without a policy version'],
      warnings: [],
    });
  });

  it('reports malformed exact source evidence as an invalid policy', () => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{ ...policyWallet('generated_pair'), sourceDescriptor: 'not-a-descriptor' }],
    });

    expect(result).toEqual({
      issues: [expect.stringContaining('has invalid descriptor policy evidence')],
      warnings: [],
    });
  });

  it('rejects a pair policy whose exact change source is not a string', () => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{ ...policyWallet('generated_pair'), sourceChangeDescriptor: 42 }],
    });

    expect(result).toEqual({
      issues: [expect.stringContaining('has invalid descriptor policy evidence')],
      warnings: [],
    });
  });

  it('rejects unexpected change-source evidence on an imported multipath policy', () => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{
        ...policyWallet('imported_multipath'),
        sourceChangeDescriptor: CHANGE,
      }],
    });

    expect(result.issues).toEqual([
      expect.stringContaining('does not match its exact source evidence'),
    ]);
  });

  it.each([
    ['wallet type', { type: 'multi_sig' }],
    ['script type', { scriptType: 'taproot' }],
    ['network family', { network: 'testnet3' }],
    ['quorum', { quorum: 1 }],
    ['signer count', { totalSigners: 1 }],
  ])('rejects descriptor evidence that contradicts the stored %s', (_label, metadata) => {
    const result = validateDescriptorPoliciesForRestore({
      wallet: [{ ...policyWallet('generated_pair'), ...metadata }],
    });

    expect(result).toEqual({
      issues: [expect.stringContaining('does not match its exact source evidence')],
      warnings: [],
    });
  });

  it('returns same-version legacy quarantine warnings from restore preflight', async () => {
    const result = await new BackupService().restoreFromBackup(legacyBackup());

    expect(result.warnings).toContain(
      '1 restored wallet(s) remain legacy-unverified and require remediation before funds-controlling use',
    );
  });

  it('rejects a policy invalidated by migration before opening a destructive transaction', async () => {
    vi.mocked(migrationService.getSchemaVersion).mockResolvedValue(2);
    const migrationCount = MIGRATIONS.length;
    MIGRATIONS.push({
      fromVersion: 1,
      toVersion: 2,
      migrate: backup => ({
        ...backup,
        data: {
          ...backup.data,
          wallet: backup.data.wallet.map(wallet => ({
            ...wallet,
            descriptorPolicyVersion: 2,
          })),
        },
      }),
    });

    try {
      const result = await new BackupService().restoreFromBackup(legacyBackup());

      expect(result).toMatchObject({
        success: false,
        committed: false,
        error: expect.stringContaining('unsupported descriptor policy version 2'),
      });
      expect(mockPrismaClient.$queryRaw).not.toHaveBeenCalled();
      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    } finally {
      MIGRATIONS.splice(migrationCount);
    }
  });
});

describe('recovered legacy descriptor policy restore', () => {
  const recoveredWallet = () => ({
    id: 'wallet-recovered',
    type: 'single_sig',
    scriptType: 'native_segwit',
    network: 'mainnet',
    quorum: null,
    totalSigners: null,
    descriptor: CANONICAL_RECEIVE,
    fingerprint: 'aabbccdd',
    changeDescriptor: CANONICAL_CHANGE,
    descriptorPolicyVersion: 1,
    descriptorSourceKind: 'recovered_legacy',
    sourceDescriptor: CANONICAL_RECEIVE,
    sourceChangeDescriptor: null,
    sourceDescriptorChecksum: null,
    sourceChangeDescriptorChecksum: null,
  });

  it('restores a recovered wallet instead of rejecting it as malformed evidence', () => {
    // Without an explicit branch this kind falls through to the multipath expander, which
    // throws on a fixed-branch token and makes every backup containing a recovered wallet
    // unrestorable.
    const result = validateDescriptorPoliciesForRestore({ wallet: [recoveredWallet()] });

    expect(result.issues).toEqual([]);
  });

  it('rejects a recovered wallet whose change descriptor was tampered with', () => {
    const wallet = { ...recoveredWallet(), changeDescriptor: CANONICAL_RECEIVE };

    const result = validateDescriptorPoliciesForRestore({ wallet: [wallet] });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toContain('does not match its exact source evidence');
  });

  it('rejects a recovered wallet whose source token is not the stored descriptor', () => {
    const wallet = { ...recoveredWallet(), sourceDescriptor: CANONICAL_CHANGE };

    const result = validateDescriptorPoliciesForRestore({ wallet: [wallet] });

    expect(result.issues).toHaveLength(1);
  });
});
