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

export function registerWalletAddressDescriptorStatsTests(): void {
  describe('address generation and descriptor repair', () => {
    it('throws when generating address for inaccessible wallet', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(generateAddress('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });

    it('generates the next receive address from descriptor', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: 'wpkh(mock)',
        addresses: [{ index: 4 }],
      });

      const address = await generateAddress('wallet-1', 'user-1');

      expect(address).toBe('bc1qmockaddress');
      expect(mockPrismaClient.address.create).toHaveBeenCalledWith({
        data: {
          walletId: 'wallet-1',
          address: 'bc1qmockaddress',
          derivationPath: "m/84'/0'/0'/0/0",
          index: 5,
          used: false,
        },
      });
    });

    it('swallows hook failures after address generation', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: 'wpkh(mock)',
        addresses: [{ index: 0 }],
      });
      mockHookExecuteAfter.mockReturnValueOnce(Promise.reject(new Error('hook address failed')));

      await expect(generateAddress('wallet-1', 'user-1')).resolves.toBe('bc1qmockaddress');

      await Promise.resolve();
      expect(mockLogWarn).toHaveBeenCalledWith(
        'After hook failed',
        expect.objectContaining({ error: expect.any(String) })
      );
    });

    it('rejects address generation when descriptor is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: null,
        addresses: [],
      });

      await expect(generateAddress('wallet-1', 'user-1')).rejects.toThrow('Wallet does not have a descriptor');
    });

    it('returns already-repaired message when descriptor exists', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: 'already-there',
        devices: [],
      });

      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).resolves.toEqual({
        success: true,
        message: 'Wallet already has a descriptor',
      });
    });

    it('throws when repair is requested for inaccessible wallet', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(repairWalletDescriptor('wallet-missing', 'owner-1')).rejects.toThrow('Wallet not found');
    });

    it('returns validation failure for single-sig wallets with invalid device count', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [
          { device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } },
          { device: { fingerprint: 'b', xpub: 'xpub-b', derivationPath: "m/84'/0'/0'" } },
        ],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('exactly 1 device');
    });

    it('returns validation failure when multisig lacks required devices', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: 3,
        descriptor: null,
        devices: [{ device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/48'/0'/0'/2'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('needs 3 devices');
    });

    it('uses default required device count for multisig repair when totalSigners is missing', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'a', xpub: 'xpub-a', derivationPath: "m/48'/0'/0'/2'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('needs 2 devices');
    });

    it('repairs descriptor and bulk-creates initial addresses', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'aabbccdd', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } }],
      });

      const result = await repairWalletDescriptor('wallet-1', 'owner-1');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Generated descriptor');
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.any(Array),
          skipDuplicates: true,
        })
      );
    });

    it('wraps descriptor build failures during repair', async () => {
      mockBuildDescriptorFromDevices.mockImplementationOnce(() => {
        throw new Error('repair descriptor failed');
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: 'aabbccdd', xpub: 'xpub-a', derivationPath: "m/84'/0'/0'" } }],
      });

      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).rejects.toThrow(
        'Failed to generate descriptor: repair descriptor failed'
      );
      expect(mockLogError).toHaveBeenCalledWith(
        'Failed to repair wallet descriptor',
        expect.objectContaining({
          walletId: 'wallet-1',
          error: 'repair descriptor failed',
        })
      );
    });

    it('normalizes missing derivationPath when repairing descriptor', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-2',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: null,
        totalSigners: null,
        descriptor: null,
        devices: [{ device: { fingerprint: '11223344', xpub: 'xpub-no-path', derivationPath: '' } }],
      });

      await repairWalletDescriptor('wallet-2', 'owner-1');

      expect(mockBuildDescriptorFromDevices).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            fingerprint: '11223344',
            derivationPath: undefined,
          }),
        ]),
        expect.any(Object)
      );
    });

    it('repairs multisig descriptor when default required signer count is satisfied', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-multi-default-ready',
        type: 'multi_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        quorum: 2,
        totalSigners: null,
        descriptor: null,
        devices: [
          { device: { fingerprint: 'a1', xpub: 'xpub-a1', derivationPath: "m/48'/0'/0'/2'" } },
          { device: { fingerprint: 'b2', xpub: 'xpub-b2', derivationPath: "m/48'/0'/0'/2'" } },
        ],
      });

      const result = await repairWalletDescriptor('wallet-multi-default-ready', 'owner-1');

      expect(result.success).toBe(true);
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
    });
  });

  describe('wallet stats aggregation', () => {
    it('returns aggregate wallet stats for authorized users', async () => {
      const { transactionRepository: txRepo } = await import('../../../../src/repositories');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-1' });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: BigInt(12000) }, _count: { _all: 4 } });
      vi.mocked(txRepo.groupByType).mockResolvedValueOnce([
        { type: 'received', _count: { id: 5 }, _sum: { amount: BigInt(45000) } },
        { type: 'sent', _count: { id: 3 }, _sum: { amount: BigInt(17000) } },
      ] as any);
      mockPrismaClient.transaction.count.mockResolvedValueOnce(12);
      mockPrismaClient.uTXO.count.mockResolvedValueOnce(4);
      mockPrismaClient.address.count.mockResolvedValueOnce(8);

      const stats = await getWalletStats('wallet-1', 'user-1');

      expect(stats).toEqual({
        balance: 12000,
        received: 45000,
        sent: 17000,
        transactionCount: 12,
        utxoCount: 4,
        addressCount: 8,
      });
    });

    it('falls back aggregate amount fields to zero when sums are null', async () => {
      const { transactionRepository: txRepo } = await import('../../../../src/repositories');
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({ id: 'wallet-2' });
      mockPrismaClient.uTXO.aggregate.mockResolvedValueOnce({ _sum: { amount: null }, _count: { _all: 0 } });
      vi.mocked(txRepo.groupByType).mockResolvedValueOnce([] as any);
      mockPrismaClient.transaction.count.mockResolvedValueOnce(0);
      mockPrismaClient.uTXO.count.mockResolvedValueOnce(0);
      mockPrismaClient.address.count.mockResolvedValueOnce(0);

      const stats = await getWalletStats('wallet-2', 'user-1');

      expect(stats).toEqual({
        balance: 0,
        received: 0,
        sent: 0,
        transactionCount: 0,
        utxoCount: 0,
        addressCount: 0,
      });
    });

    it('throws when wallet is not accessible to user', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(getWalletStats('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });
  });
}
