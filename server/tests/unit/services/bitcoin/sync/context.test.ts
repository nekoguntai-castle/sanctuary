import { describe, expect, it } from 'vitest';
import {
  createSyncContext,
  createSyncStats,
  createTestContext,
} from '../../../../../src/services/bitcoin/sync/context';
import type { Wallet } from '../../../../../src/generated/prisma/client';

const testWallet = {
  id: 'wallet-ctx',
  name: 'Context Test Wallet',
  type: 'single_sig',
  scriptType: 'native_segwit',
  network: 'testnet3',
  quorum: null,
  totalSigners: null,
  descriptor: null,
  changeDescriptor: null,
  descriptorPolicyVersion: null,
  descriptorSourceKind: null,
  sourceDescriptor: null,
  sourceChangeDescriptor: null,
  sourceDescriptorChecksum: null,
  sourceChangeDescriptorChecksum: null,
  canonicalPolicyId: null,
  canonicalPolicyVersion: null,
  fingerprint: null,
  groupId: null,
  groupRole: 'viewer',
  lastSyncedAt: null,
  lastSyncedBlockHeight: null,
  lastSyncStatus: null,
  lastSyncError: null,
  lastSyncFailureClass: null,
  syncInProgress: false,
  syncExecutionOwner: null,
  syncRetryCount: 0,
  syncNextRetryAt: null,
  syncStartedAt: null,
  syncStateVersion: 0,
  requestedIncrementalSyncGeneration: 0,
  claimedIncrementalSyncGeneration: 0,
  processedIncrementalSyncGeneration: 0,
  incrementalSyncLeaseToken: null,
  incrementalSyncClaimedAt: null,
  incrementalSyncLeaseExpiresAt: null,
  syncActionRequiredAt: null,
  requestedFullResyncGeneration: 0,
  preparedFullResyncGeneration: 0,
  processedFullResyncGeneration: 0,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
} satisfies Wallet;

describe('Sync context factory', () => {
  it('builds lookup structures and skips missing derivation paths', () => {
    const ctx = createSyncContext({
      walletId: 'wallet-ctx',
      wallet: testWallet,
      network: 'testnet3',
      client: {} as any,
      addresses: [
        {
          id: 'addr-1',
          address: 'tb1qcontextaddress000000000000000000000000000001',
          derivationPath: "m/84'/1'/0'/0/0",
        } as any,
        {
          id: 'addr-2',
          address: 'tb1qcontextaddress000000000000000000000000000002',
          derivationPath: null,
        } as any,
      ],
      currentBlockHeight: 1_000,
    });

    expect(ctx.walletAddressSet.has('tb1qcontextaddress000000000000000000000000000001')).toBe(true);
    expect(ctx.walletAddressSet.has('tb1qcontextaddress000000000000000000000000000002')).toBe(true);
    expect(ctx.addressMap.get('tb1qcontextaddress000000000000000000000000000001')?.id).toBe('addr-1');
    expect(ctx.addressToDerivationPath.get('tb1qcontextaddress000000000000000000000000000001')).toBe("m/84'/1'/0'/0/0");
    expect(ctx.addressToDerivationPath.has('tb1qcontextaddress000000000000000000000000000002')).toBe(false);
  });

  it('derives an ownership script for legacy rows that never got canonical evidence', () => {
    const ctx = createSyncContext({
      walletId: 'wallet-ctx',
      wallet: testWallet,
      network: 'testnet3',
      client: {} as any,
      addresses: [
        {
          id: 'legacy-1',
          address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
          derivationPath: "m/84'/1'/0'/0/0",
          scriptPubKey: null,
        } as any,
      ],
      currentBlockHeight: 1_000,
    });

    const script = '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1';
    expect(ctx.addressMap.get('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl')?.scriptPubKey).toBe(script);
    expect(ctx.walletScriptToAddress.get(script)?.id).toBe('legacy-1');
  });

  it('leaves a persisted canonical script exactly as stored', () => {
    const stored = '0014d0c4a3ef09e997b6e99e397e518fe3e41a118ca1';
    const ctx = createSyncContext({
      walletId: 'wallet-ctx',
      wallet: testWallet,
      network: 'testnet3',
      client: {} as any,
      addresses: [
        {
          id: 'canonical-1',
          address: 'tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl',
          derivationPath: "m/84'/1'/0'/0/0",
          scriptPubKey: stored,
        } as any,
      ],
      currentBlockHeight: 1_000,
    });

    expect(ctx.addressMap.get('tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl')?.scriptPubKey).toBe(stored);
    expect(ctx.walletScriptToAddress.get(stored)?.id).toBe('canonical-1');
    expect(ctx.authenticatedTransactionEvidence).toEqual(new Map());
    expect(ctx.authenticatedOutpointEvidence).toEqual(new Map());
    expect(ctx.authenticatedOutpointCoverage).toEqual(new Map());
  });

  it('applies overrides in test context while preserving defaults', () => {
    const stats = createSyncStats();
    stats.newAddressesGenerated = 3;

    const ctx = createTestContext({
      stats,
      viaTor: true,
      completedPhases: ['phase-a'],
    });

    expect(ctx.stats.newAddressesGenerated).toBe(3);
    expect(ctx.viaTor).toBe(true);
    expect(ctx.completedPhases).toEqual(['phase-a']);
    expect(ctx.walletId).toBe('test-wallet-id');
  });
});
