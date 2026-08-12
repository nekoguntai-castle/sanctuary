import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockBuildDescriptorFromDevices,
  mockHookExecuteAfter,
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
import * as addressDerivation from '../../../../src/services/bitcoin/addressDerivation';
import { MAINNET_BIP84_DESCRIPTORS } from './descriptorTestFixtures';

const VALID_RECEIVE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.receive;
const VALID_CHANGE_DESCRIPTOR = MAINNET_BIP84_DESCRIPTORS.change;
const NATIVE_SEGWIT_POLICY_ID = 'single-sig-native-segwit-bip84-v1';

export function registerWalletAddressDescriptorStatsTests(): void {
  describe('address generation and descriptor repair', () => {
    beforeEach(() => {
      mockBuildDescriptorFromDevices.mockReturnValue({
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        fingerprint: 'abc12345',
      });
    });

    it('throws when generating address for inaccessible wallet', async () => {
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce(null);
      await expect(generateAddress('wallet-missing', 'user-1')).rejects.toThrow('Wallet not found');
    });

    it('generates the next receive address from descriptor', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: 'wallet-1',
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
        canonicalPolicyVersion: 1,
      });

      const address = await generateAddress('wallet-1', 'user-1');

      expect(address).toBe('bc1qmockaddress');
      const { addressRepository } = await import('../../../../src/repositories');
      expect(addressRepository.createNextCanonical).toHaveBeenCalledWith(
        'wallet-1',
        0,
        expect.any(Function),
      );
      expect(addressDerivation.deriveCanonicalAddress).toHaveBeenCalledWith(
        {
          receiveDescriptor: VALID_RECEIVE_DESCRIPTOR,
          changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        },
        { branch: 0, index: 5, network: 'mainnet' },
      );
      const persisted = await vi.mocked(addressRepository.createNextCanonical).mock.results[0].value;
      expect(persisted).toMatchObject({
        walletId: 'wallet-1',
        address: 'bc1qmockaddress',
        derivationPath: "m/84'/0'/0'/0/5",
        scriptPubKey: '0014mockscriptpubkey',
        branch: 0,
        index: 5,
        coordinateVersion: 1,
        canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
        canonicalPolicyVersion: 1,
        used: false,
      });
      expect(mockPrismaClient.address.create).not.toHaveBeenCalled();
    });

    it('swallows hook failures after address generation', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: 'wallet-1',
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        canonicalPolicyId: NATIVE_SEGWIT_POLICY_ID,
        canonicalPolicyVersion: 1,
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
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: 'wallet-1',
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-1',
        network: 'mainnet',
        descriptor: null,
        changeDescriptor: null,
      });

      await expect(generateAddress('wallet-1', 'user-1')).rejects.toThrow('Wallet does not have a descriptor');
    });

    it('fails closed for a legacy descriptor wallet without persisted canonical policy identity', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        id: 'wallet-legacy',
        devices: [{ device: { type: 'coldcard', model: null } }],
      });
      mockPrismaClient.wallet.findFirst.mockResolvedValueOnce({
        id: 'wallet-legacy',
        type: 'single_sig',
        scriptType: 'native_segwit',
        network: 'mainnet',
        descriptor: VALID_RECEIVE_DESCRIPTOR,
        changeDescriptor: VALID_CHANGE_DESCRIPTOR,
        canonicalPolicyId: null,
        canonicalPolicyVersion: null,
      });

      await expect(generateAddress('wallet-legacy', 'user-1')).rejects.toThrow(
        'Wallet canonical policy identity is missing or inconsistent',
      );
      const { addressRepository } = await import('../../../../src/repositories');
      expect(addressRepository.createNextCanonical).not.toHaveBeenCalled();
      expect(addressDerivation.deriveCanonicalAddress).not.toHaveBeenCalled();
    });

    it('fails closed at the retired direct-repair service boundary', async () => {
      await expect(repairWalletDescriptor('wallet-1', 'owner-1')).rejects.toThrow(
        'Direct wallet repair is retired',
      );
      expect(mockPrismaClient.wallet.findFirst).not.toHaveBeenCalled();
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
