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
  syncInProgress: false,
  requestedFullResyncGeneration: 0,
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
