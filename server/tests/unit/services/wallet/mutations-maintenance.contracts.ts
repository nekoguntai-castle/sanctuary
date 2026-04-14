import { describe, expect, it, vi } from 'vitest';
import {
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
  mockLogError,
  mockLogWarn,
  mockNotificationUnsubscribeWalletAddresses,
  mockPrismaClient,
  mockSyncUnsubscribeWalletAddresses,
} from './walletTestHarness';
import {
  addDeviceToWallet,
  checkWalletAccess,
  checkWalletAccessWithRole,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  createWallet,
  deleteWallet,
  generateAddress,
  getUserWalletRole,
  getUserWallets,
  getWalletById,
  getWalletStats,
  repairWalletDescriptor,
  updateWallet,
} from '../../../../src/services/wallet';

export function registerWalletMutationMaintenanceTests(): void {
  describe('wallet mutation and maintenance operations', () => {
    it('updates wallet metadata for owners and returns computed fields', async () => {
      const walletData = {
        id: 'wallet-1',
        name: 'Renamed Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'abcd1234',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        devices: [{ id: 'd1' }],
        addresses: [{ id: 'a1' }, { id: 'a2' }],
        group: { name: 'Treasury' },
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(9876) } });

      const updated = await updateWallet('wallet-1', 'owner-1', { name: 'Renamed Wallet' });

      expect(updated.balance).toBe(9876);
      expect(updated.deviceCount).toBe(1);
      expect(updated.addressCount).toBe(2);
      expect(updated.isShared).toBe(true);
    });

    it('falls back to zero balance and private sharing metadata for owner updates', async () => {
      const walletData = {
        id: 'wallet-private',
        name: 'Private Wallet',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f0',
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null } });

      const updated = await updateWallet('wallet-private', 'owner-1', { name: 'Private Wallet' });

      expect(updated.balance).toBe(0);
      expect(updated.isShared).toBe(false);
      expect(updated.sharedWith).toBeUndefined();
    });

    it('uses null groupName for shared wallets without a group object', async () => {
      const walletData = {
        id: 'wallet-shared-no-group',
        name: 'Shared No Group',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'desc',
        fingerprint: 'f9',
        createdAt: new Date('2025-01-03T00:00:00.000Z'),
        devices: [],
        addresses: [],
        group: null,
        users: [{ userId: 'owner-1' }, { userId: 'owner-2' }],
      };
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockPrismaClient.wallet.update.mockResolvedValueOnce(walletData);
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(walletData);
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(5) } });

      const updated = await updateWallet('wallet-shared-no-group', 'owner-1', { name: 'Shared No Group' });

      expect(updated.isShared).toBe(true);
      expect(updated.sharedWith).toEqual({
        groupName: null,
        userCount: 2,
      });
    });

    it('rejects update for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(updateWallet('wallet-1', 'viewer-1', { name: 'Nope' })).rejects.toThrow('Only wallet owners can update wallet');
    });

    it('deletes wallet after unsubscribing realtime listeners', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });

      await deleteWallet('wallet-1', 'owner-1');

      expect(mockSyncUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockNotificationUnsubscribeWalletAddresses).toHaveBeenCalledWith('wallet-1');
      expect(mockPrismaClient.wallet.delete).toHaveBeenCalledWith({ where: { id: 'wallet-1' } });
    });

    it('swallows hook failures after delete', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce({ role: 'owner' });
      mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook delete failed')));

      await deleteWallet('wallet-1', 'owner-1');

      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'After hook failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects delete for non-owner users', async () => {
      mockPrismaClient.walletUser.findFirst.mockResolvedValueOnce(null);
      await expect(deleteWallet('wallet-1', 'viewer-1')).rejects.toThrow('Only wallet owners can delete wallet');
    });

    it('links a device and regenerates descriptor when requirements are met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await addDeviceToWallet('wallet-1', 'device-1', 'user-1', 0);

      const { walletRepository: walletRepo } = await import('../../../../src/repositories');
      expect(walletRepo.linkDevice).toHaveBeenCalledWith('wallet-1', 'device-1', 0);
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet-1' },
        data: {
          descriptor: 'wpkh([abc12345/84h/0h/0h]xpub...)',
          fingerprint: 'abc12345',
        },
      });
    });

    it('still links device when descriptor generation fails', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet('wallet-1', 'device-1', 'user-1')).resolves.toBeUndefined();
      const { walletRepository: walletRepo3 } = await import('../../../../src/repositories');
      expect(walletRepo3.linkDevice).toHaveBeenCalled();
    });

    it('defers multisig descriptor generation until required signer threshold is met', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-existing',
            device: {
              id: 'device-existing',
              userId: 'user-1',
              fingerprint: 'eeeeffff',
              xpub: 'xpub-existing',
              derivationPath: "m/48'/0'/0'/2'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-new',
        userId: 'user-1',
        fingerprint: 'aaaabbbb',
        xpub: 'xpub-new',
        derivationPath: "m/48'/0'/0'/2'",
      });

      await addDeviceToWallet('wallet-multi', 'device-new', 'user-1', 1);

      const { walletRepository: walletRepo2 } = await import('../../../../src/repositories');
      expect(walletRepo2.linkDevice).toHaveBeenCalled();
      expect(mockBuildDescriptorFromDevices).not.toHaveBeenCalled();
      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
    });

    it('generates multisig descriptor when signer threshold is met and normalizes missing derivation paths', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi-ready',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 2,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-existing',
            device: {
              id: 'device-existing',
              userId: 'user-1',
              fingerprint: '11112222',
              xpub: 'xpub-existing',
              derivationPath: "m/48'/0'/0'/2'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-new',
        userId: 'user-1',
        fingerprint: '33334444',
        xpub: 'xpub-new',
        derivationPath: '',
      });

      await addDeviceToWallet('wallet-multi-ready', 'device-new', 'user-1', 1);

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            fingerprint: '33334444',
            derivationPath: undefined,
          }),
        ]),
        expect.any(Object)
      );
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
    });

    it('rejects addDeviceToWallet when wallet is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);

      await expect(addDeviceToWallet('wallet-missing', 'device-1', 'user-1')).rejects.toThrow('Wallet not found');
    });

    it('rejects addDeviceToWallet when device is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce(null);

      await expect(addDeviceToWallet('wallet-1', 'device-missing', 'user-1')).rejects.toThrow('Device not found');
    });

    it('rejects addDeviceToWallet when device is already linked', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [
          {
            deviceId: 'device-1',
            device: {
              id: 'device-1',
              userId: 'user-1',
              fingerprint: 'aabbccdd',
              xpub: 'xpub-device-1',
              derivationPath: "m/84'/0'/0'",
            },
          },
        ],
      });
      mockPrismaClient.device.findFirst.mockResolvedValueOnce({
        id: 'device-1',
        userId: 'user-1',
        fingerprint: 'aabbccdd',
        xpub: 'xpub-device-1',
        derivationPath: "m/84'/0'/0'",
      });

      await expect(addDeviceToWallet('wallet-1', 'device-1', 'user-1')).rejects.toThrow(
        'Device is already linked to this wallet'
      );
    });
  });
}
