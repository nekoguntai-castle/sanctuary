import { describe, expect, it, type Mock, vi } from 'vitest';

import {
  mockWallet,
  prisma,
  walletRepository,
} from './walletRepositoryTestHarness';

export const registerWalletRepositoryMutationContracts = () => {
  describe('updateSyncState', () => {
    it('should update sync state fields', async () => {
      const updatedWallet = {
        ...mockWallet,
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      };

      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.updateSyncState('wallet-123', {
        syncInProgress: true,
        lastSyncStatus: 'syncing',
      });

      expect(result.syncInProgress).toBe(true);
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: true,
          lastSyncStatus: 'syncing',
          syncStateVersion: { increment: 1 },
        },
      });
    });
  });

  describe('findSyncState', () => {
    it('selects only the authoritative lifecycle snapshot', async () => {
      const snapshot = {
        syncInProgress: true,
        lastSyncedAt: null,
        lastSyncStatus: 'retrying',
        lastSyncError: 'temporary failure',
        lastSyncFailureClass: 'other',
        syncExecutionOwner: 'inline',
        syncRetryCount: 1,
        syncNextRetryAt: new Date('2026-08-20T12:01:00.000Z'),
        syncStartedAt: null,
        syncStateVersion: 4,
      };
      (prisma.wallet.findUnique as Mock).mockResolvedValue(snapshot);

      await expect(walletRepository.findSyncState('wallet-123')).resolves.toEqual(snapshot);
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        select: {
          syncInProgress: true,
          lastSyncedAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
          lastSyncFailureClass: true,
          syncExecutionOwner: true,
          syncRetryCount: true,
          syncNextRetryAt: true,
          syncStartedAt: true,
          syncStateVersion: true,
          requestedIncrementalSyncGeneration: true,
          claimedIncrementalSyncGeneration: true,
          processedIncrementalSyncGeneration: true,
          incrementalSyncClaimedAt: true,
          incrementalSyncLeaseExpiresAt: true,
          syncActionRequiredAt: true,
          requestedFullResyncGeneration: true,
          preparedFullResyncGeneration: true,
          processedFullResyncGeneration: true,
        },
      });
    });
  });

  describe('completeSyncSuccess', () => {
    it('commits block height and lifecycle success atomically', async () => {
      const syncedAt = new Date('2026-08-20T12:00:00.000Z');
      (prisma.wallet.update as Mock).mockResolvedValue(mockWallet);

      await walletRepository.completeSyncSuccess('wallet-123', syncedAt, 900_000);

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          lastSyncedAt: syncedAt,
          lastSyncedBlockHeight: 900_000,
          lastSyncStatus: 'success',
          lastSyncError: null,
          lastSyncFailureClass: null,
          syncInProgress: false,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });
  });

  describe('resetSyncState', () => {
    it('should reset all sync fields to default', async () => {
      const resetWallet = {
        ...mockWallet,
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
      };

      (prisma.wallet.update as Mock).mockResolvedValue(resetWallet);

      const result = await walletRepository.resetSyncState('wallet-123');

      expect(result.syncInProgress).toBe(false);
      expect(result.lastSyncedAt).toBeNull();
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: {
          syncInProgress: false,
          lastSyncedAt: null,
          lastSyncStatus: null,
          lastSyncError: null,
          lastSyncFailureClass: null,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });
  });

  describe('update', () => {
    it('should update wallet with provided data', async () => {
      const updatedWallet = { ...mockWallet, name: 'Updated Name' };
      (prisma.wallet.update as Mock).mockResolvedValue(updatedWallet);

      const result = await walletRepository.update('wallet-123', { name: 'Updated Name' });

      expect(result.name).toBe('Updated Name');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        data: { name: 'Updated Name' },
      });
    });
  });

  describe('linkDevice', () => {
    it('creates a walletDevice record', async () => {
      const signer = {
        deviceId: 'd1',
        deviceAccountId: 'a1',
        signerIndex: 0,
        signerBindingVersion: 1 as const,
        signerFingerprint: '12345678',
        signerXpub: 'xpub-1',
        signerDerivationPath: "m/84'/0'/0'",
        signerPurpose: 'single_sig',
        signerScriptType: 'native_segwit',
      };
      prisma.walletDevice.create.mockResolvedValueOnce({ walletId: 'w1', ...signer });
      await walletRepository.linkDevice('w1', signer);
      expect(prisma.walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', ...signer },
      });
    });
  });

  describe('linkDeviceWithDescriptor', () => {
    const signer = {
      deviceId: 'd1',
      deviceAccountId: 'a1',
      signerIndex: 0,
      signerBindingVersion: 1 as const,
      signerFingerprint: '12345678',
      signerXpub: 'xpub-1',
      signerDerivationPath: "m/84'/0'/0'",
      signerPurpose: 'single_sig',
      signerScriptType: 'native_segwit',
    };
    const assignment = {
      descriptor: 'wpkh(test)',
      changeDescriptor: 'wpkh(test-change)',
      descriptorPolicyVersion: 1 as const,
      descriptorSourceKind: 'generated_pair' as const,
      sourceDescriptor: 'wpkh(test)',
      sourceChangeDescriptor: 'wpkh(test-change)',
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: '12345678',
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      addresses: [{
        walletId: 'w1',
        address: 'bc1qtest',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
      }],
    };

    it('writes the signer, descriptor, and addresses in one transaction', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'mainnet' });
      prisma.address.createManyAndReturn.mockResolvedValueOnce([{ id: 'descriptor-address' }]);

      await walletRepository.linkDeviceWithDescriptor('w1', signer, assignment);

      expect(prisma.walletDevice.create).toHaveBeenCalledWith({
        data: { walletId: 'w1', ...signer },
      });
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'w1',
          descriptor: null,
          descriptorPolicyVersion: null,
          addresses: { none: {} },
        },
        data: expect.objectContaining({
          descriptor: 'wpkh(test)',
          fingerprint: '12345678',
        }),
      });
      expect(prisma.address.createManyAndReturn).toHaveBeenCalledWith({
        data: assignment.addresses,
        select: { id: true },
      });
      expect(prisma.addressSubscriptionCheckpoint.createMany).toHaveBeenCalledWith({
        data: [{ addressId: 'descriptor-address', network: 'mainnet' }],
      });
    });

    it('fails closed when a concurrent descriptor assignment wins', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        walletRepository.linkDeviceWithDescriptor('w1', signer, assignment),
      ).rejects.toThrow('Wallet descriptor changed');
      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('rejects descriptor addresses assigned to a different wallet', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });

      await expect(walletRepository.linkDeviceWithDescriptor('w1', signer, {
        ...assignment,
        addresses: [{ ...assignment.addresses[0], walletId: 'w2' }],
      })).rejects.toThrow('Descriptor address wallet identity does not match its assignment');

      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('fails closed when the wallet disappears during descriptor assignment', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce(null);

      await expect(
        walletRepository.linkDeviceWithDescriptor('w1', signer, assignment),
      ).rejects.toThrow('Wallet disappeared during descriptor assignment');

      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.addressSubscriptionCheckpoint.createMany).not.toHaveBeenCalled();
    });

    it('rejects a wallet network that cannot own subscription checkpoints', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'testnet' });

      await expect(
        walletRepository.linkDeviceWithDescriptor('w1', signer, assignment),
      ).rejects.toThrow('Wallet address persistence requires a supported subscription network');

      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.addressSubscriptionCheckpoint.createMany).not.toHaveBeenCalled();
    });

    it('assigns descriptor metadata without issuing empty address or checkpoint writes', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'mainnet' });

      await walletRepository.linkDeviceWithDescriptor('w1', signer, {
        ...assignment,
        addresses: [],
      });

      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
      expect(prisma.addressSubscriptionCheckpoint.createMany).not.toHaveBeenCalled();
    });

    it('propagates address insertion failure from the atomic signer assignment', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'mainnet' });
      prisma.address.createManyAndReturn.mockRejectedValueOnce(new Error('address insertion failed'));

      await expect(
        walletRepository.linkDeviceWithDescriptor('w1', signer, assignment),
      ).rejects.toThrow('address insertion failed');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.walletDevice.create).toHaveBeenCalled();
      expect(prisma.wallet.updateMany).toHaveBeenCalled();
      expect(prisma.address.createManyAndReturn).toHaveBeenCalled();
    });

    it('propagates checkpoint failure from the atomic signer assignment', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'mainnet' });
      prisma.address.createManyAndReturn.mockResolvedValueOnce([{ id: 'uncommitted-address' }]);
      prisma.addressSubscriptionCheckpoint.createMany.mockRejectedValueOnce(
        new Error('checkpoint insertion failed'),
      );

      await expect(
        walletRepository.linkDeviceWithDescriptor('w1', signer, assignment),
      ).rejects.toThrow('checkpoint insertion failed');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.addressSubscriptionCheckpoint.createMany).toHaveBeenCalledWith({
        data: [{ addressId: 'uncommitted-address', network: 'mainnet' }],
      });
    });
  });

  describe('assignDescriptorWithAddresses', () => {
    const assignment = {
      descriptor: 'wpkh(repair-test)',
      changeDescriptor: 'wpkh(repair-change-test)',
      descriptorPolicyVersion: 1 as const,
      descriptorSourceKind: 'generated_pair' as const,
      sourceDescriptor: 'wpkh(repair-test)',
      sourceChangeDescriptor: 'wpkh(repair-change-test)',
      sourceDescriptorChecksum: null,
      sourceChangeDescriptorChecksum: null,
      fingerprint: '87654321',
      canonicalPolicyId: 'single-sig-native-segwit-bip84-v1',
      canonicalPolicyVersion: 1,
      addresses: [{
        walletId: 'w1',
        address: 'bc1qrepair',
        derivationPath: "m/84'/0'/0'/0/0",
        index: 0,
        used: false,
      }],
    };

    it('assigns a missing descriptor and its derived addresses in one transaction', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'signet' });
      prisma.address.createManyAndReturn.mockResolvedValueOnce([{ id: 'repair-address' }]);

      await walletRepository.assignDescriptorWithAddresses('w1', assignment);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'w1',
          descriptor: null,
          descriptorPolicyVersion: null,
          addresses: { none: {} },
        },
        data: expect.objectContaining({
          descriptor: assignment.descriptor,
          fingerprint: assignment.fingerprint,
        }),
      });
      expect(prisma.address.createManyAndReturn).toHaveBeenCalledWith({
        data: assignment.addresses,
        select: { id: true },
      });
      expect(prisma.addressSubscriptionCheckpoint.createMany).toHaveBeenCalledWith({
        data: [{ addressId: 'repair-address', network: 'signet' }],
      });
    });

    it('does not create addresses when a concurrent descriptor assignment wins', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        walletRepository.assignDescriptorWithAddresses('w1', assignment),
      ).rejects.toThrow('Wallet descriptor changed before signer binding completed');

      expect(prisma.address.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('propagates address insertion failure from the atomic repair assignment', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 1 });
      prisma.wallet.findUnique.mockResolvedValueOnce({ network: 'mainnet' });
      prisma.address.createManyAndReturn.mockRejectedValueOnce(
        new Error('repair address insertion failed'),
      );

      await expect(
        walletRepository.assignDescriptorWithAddresses('w1', assignment),
      ).rejects.toThrow('repair address insertion failed');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.wallet.updateMany).toHaveBeenCalled();
      expect(prisma.address.createManyAndReturn).toHaveBeenCalled();
    });
  });

  describe('createWithDeviceLinks', () => {
    const initialAddresses = [{
      address: 'bc1qcreate',
      derivationPath: "m/84'/0'/0'/0/0",
      index: 0,
      used: false,
    }];

    it('creates wallet, signer links, and initial addresses atomically', async () => {
      const created = {
        id: 'new-wallet',
        devices: [{ deviceId: 'd1' }],
        addresses: [{ id: 'address-1' }],
      };
      const walletCreate = vi.fn().mockResolvedValue({ id: 'new-wallet', network: 'mainnet' });
      const walletFindUnique = vi.fn().mockResolvedValue(created);
      const walletDeviceCreateMany = vi.fn().mockResolvedValue({ count: 1 });
      const addressCreateManyAndReturn = vi.fn().mockResolvedValue([{ id: 'address-1' }]);
      const checkpointCreateMany = vi.fn().mockResolvedValue({ count: 1 });
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: walletCreate, findUnique: walletFindUnique },
          walletDevice: { createMany: walletDeviceCreateMany },
          address: { createManyAndReturn: addressCreateManyAndReturn },
          addressSubscriptionCheckpoint: { createMany: checkpointCreateMany },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
        [{
          deviceId: 'd1',
          deviceAccountId: 'a1',
          signerIndex: 0,
          signerBindingVersion: 1,
          signerFingerprint: '12345678',
          signerXpub: 'xpub-1',
          signerDerivationPath: "m/84'/0'/0'",
          signerPurpose: 'single_sig',
          signerScriptType: 'native_segwit',
        }],
        initialAddresses,
      );

      expect(result.id).toBe('new-wallet');
      expect(walletCreate).toHaveBeenCalledTimes(1);
      expect(walletDeviceCreateMany).toHaveBeenCalledTimes(1);
      expect(addressCreateManyAndReturn).toHaveBeenCalledWith({
        data: [{ walletId: 'new-wallet', ...initialAddresses[0] }],
        select: { id: true },
      });
      expect(checkpointCreateMany).toHaveBeenCalledWith({
        data: [{ addressId: 'address-1', network: 'mainnet' }],
      });
      expect(checkpointCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
        walletFindUnique.mock.invocationCallOrder[0],
      );
    });

    it('creates wallet without device links when signers are omitted', async () => {
      const created = { id: 'new-wallet', devices: [], addresses: [] };
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'new-wallet' }), findUnique: vi.fn().mockResolvedValue(created) },
          walletDevice: { createMany: vi.fn() },
          address: { createManyAndReturn: vi.fn() },
          addressSubscriptionCheckpoint: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      const result = await walletRepository.createWithDeviceLinks(
        { name: 'Test', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' } as any,
      );

      expect(result.id).toBe('new-wallet');
    });

    it('propagates initial address insertion failure before returning a wallet', async () => {
      const walletFindUnique = vi.fn();
      const addressCreateManyAndReturn = vi.fn().mockRejectedValue(
        new Error('atomic create address insertion failed'),
      );
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: {
            create: vi.fn().mockResolvedValue({ id: 'new-wallet', network: 'mainnet' }),
            findUnique: walletFindUnique,
          },
          walletDevice: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
          address: { createManyAndReturn: addressCreateManyAndReturn },
          addressSubscriptionCheckpoint: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      await expect(walletRepository.createWithDeviceLinks(
        { name: 'Atomic create', type: 'single_sig', scriptType: 'native_segwit', network: 'mainnet' },
        [],
        initialAddresses,
      )).rejects.toThrow('atomic create address insertion failed');

      expect(addressCreateManyAndReturn).toHaveBeenCalledWith({
        data: [{ walletId: 'new-wallet', ...initialAddresses[0] }],
        select: { id: true },
      });
      expect(walletFindUnique).not.toHaveBeenCalled();
    });

    it('propagates initial-address checkpoint failure before returning a wallet', async () => {
      const walletFindUnique = vi.fn();
      const checkpointCreateMany = vi.fn().mockRejectedValue(
        new Error('atomic create checkpoint failed'),
      );
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: {
            create: vi.fn().mockResolvedValue({ id: 'new-wallet', network: 'testnet4' }),
            findUnique: walletFindUnique,
          },
          walletDevice: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
          address: {
            createManyAndReturn: vi.fn().mockResolvedValue([{ id: 'uncommitted-address' }]),
          },
          addressSubscriptionCheckpoint: { createMany: checkpointCreateMany },
        };
        return fn(tx);
      });

      await expect(walletRepository.createWithDeviceLinks(
        { name: 'Atomic create', type: 'single_sig', scriptType: 'native_segwit', network: 'testnet4' },
        [],
        initialAddresses,
      )).rejects.toThrow('atomic create checkpoint failed');

      expect(checkpointCreateMany).toHaveBeenCalledWith({
        data: [{ addressId: 'uncommitted-address', network: 'testnet4' }],
      });
      expect(walletFindUnique).not.toHaveBeenCalled();
    });

    it('throws when wallet creation returns null', async () => {
      prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          wallet: { create: vi.fn().mockResolvedValue({ id: 'ghost' }), findUnique: vi.fn().mockResolvedValue(null) },
          walletDevice: { createMany: vi.fn() },
          address: { createManyAndReturn: vi.fn() },
          addressSubscriptionCheckpoint: { createMany: vi.fn() },
        };
        return fn(tx);
      });

      await expect(
        walletRepository.createWithDeviceLinks({ name: 'Ghost' } as any),
      ).rejects.toThrow('Failed to create wallet');
    });
  });

  describe('resetAllStuckSyncFlags', () => {
    it('should reset all stuck sync flags and return count', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 3 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(3);
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          syncInProgress: true,
          OR: [
            { syncExecutionOwner: null },
            { syncExecutionOwner: 'inline' },
          ],
        },
        data: {
          syncInProgress: false,
          lastSyncStatus: null,
          lastSyncError: null,
          lastSyncFailureClass: null,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });

    it('should return 0 when no stuck wallets', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 0 });

      const result = await walletRepository.resetAllStuckSyncFlags();

      expect(result).toBe(0);
    });
  });

  describe('findStuckSyncing', () => {
    it('should find wallets with syncInProgress=true', async () => {
      const stuck = [{ id: 'w1', name: 'Wallet 1' }];
      (prisma.wallet.findMany as Mock).mockResolvedValue(stuck);

      const result = await walletRepository.findStuckSyncing();

      expect(result).toEqual(stuck);
      expect(prisma.wallet.findMany).toHaveBeenCalledWith({
        where: { syncInProgress: true },
        select: {
          id: true,
          name: true,
          syncExecutionOwner: true,
          syncStartedAt: true,
          syncStateVersion: true,
        },
        orderBy: [
          { syncStartedAt: 'asc' },
          { id: 'asc' },
        ],
        take: 100,
      });
    });
  });

  describe('clearSyncStateIfUnchanged', () => {
    it('uses the observed lifecycle version as a compare-and-swap guard', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 1 });
      const clearedState = {
        syncInProgress: false,
        lastSyncedAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
        syncStateVersion: 8,
      };
      (prisma.wallet.findUnique as Mock).mockResolvedValue(clearedState);
      const startedAt = new Date('2026-08-20T12:00:00.000Z');
      const candidate = {
        id: 'wallet-123',
        syncExecutionOwner: 'worker',
        syncStartedAt: startedAt,
        syncStateVersion: 7,
      };

      await expect(walletRepository.clearSyncStateIfUnchanged(candidate)).resolves.toEqual(
        clearedState,
      );
      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          ...candidate,
          syncInProgress: true,
        },
        data: {
          syncInProgress: false,
          lastSyncStatus: null,
          lastSyncError: null,
          lastSyncFailureClass: null,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
      expect(prisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
        select: {
          syncInProgress: true,
          lastSyncedAt: true,
          lastSyncStatus: true,
          lastSyncError: true,
          lastSyncFailureClass: true,
          syncExecutionOwner: true,
          syncRetryCount: true,
          syncNextRetryAt: true,
          syncStartedAt: true,
          syncStateVersion: true,
          requestedIncrementalSyncGeneration: true,
          claimedIncrementalSyncGeneration: true,
          processedIncrementalSyncGeneration: true,
          incrementalSyncClaimedAt: true,
          incrementalSyncLeaseExpiresAt: true,
          syncActionRequiredAt: true,
          requestedFullResyncGeneration: true,
          preparedFullResyncGeneration: true,
          processedFullResyncGeneration: true,
        },
      });
    });

    it('reports a stale observation when no row matches', async () => {
      (prisma.wallet.updateMany as Mock).mockResolvedValue({ count: 0 });
      await expect(walletRepository.clearSyncStateIfUnchanged({
        id: 'wallet-123',
        syncExecutionOwner: null,
        syncStartedAt: null,
        syncStateVersion: 1,
      })).resolves.toBeNull();
      expect(prisma.wallet.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('deleteById', () => {
    it('should delete a wallet by ID', async () => {
      (prisma.wallet.delete as Mock).mockResolvedValue(mockWallet);

      await walletRepository.deleteById('wallet-123');

      expect(prisma.wallet.delete).toHaveBeenCalledWith({
        where: { id: 'wallet-123' },
      });
    });
  });

  describe('demoteStrandedInlineRetries', () => {
    it('demotes inline and legacy retrying rows that have no sync in flight', async () => {
      // The retry ladder is an in-heap setTimeout, so a restart leaves
      // lastSyncStatus='retrying' with no timer and no reaper that selects it
      // (findStuckWithCutoff requires syncInProgress=true). 2026-08-20.
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 2 });

      await expect(walletRepository.demoteStrandedInlineRetries('restarted', 'other')).resolves.toBe(2);

      expect(prisma.wallet.updateMany).toHaveBeenCalledWith({
        where: {
          lastSyncStatus: 'retrying',
          OR: [
            { syncExecutionOwner: null },
            { syncExecutionOwner: 'inline' },
          ],
          syncInProgress: false,
        },
        data: {
          lastSyncStatus: 'failed',
          lastSyncError: 'restarted',
          lastSyncFailureClass: 'other',
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
          syncStateVersion: { increment: 1 },
        },
      });
    });

    it('reports zero when nothing was stranded', async () => {
      prisma.wallet.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(walletRepository.demoteStrandedInlineRetries('restarted', 'other')).resolves.toBe(0);
    });
  });
};
