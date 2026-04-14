import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPrismaClient, resetPrismaMocks } from '../../../../mocks/prisma';
import {
  mockElectrumClient,
  createMockTransaction,
  createMockUTXO,
  createMockAddressHistory,
} from '../../../../mocks/electrum';
import { sampleUtxos, sampleWallets, testnetAddresses } from '../../../../fixtures/bitcoin';
import { validateAddress } from '../../../../../src/services/bitcoin/utils';
import * as addressDerivation from '../../../../../src/services/bitcoin/addressDerivation';
import * as syncModule from '../../../../../src/services/bitcoin/sync';
import { getBlockchainService } from './blockchainTestHarness';

export function registerBlockchainGapLimitTests(): void {
  describe('ensureGapLimit', () => {
    const walletId = 'test-wallet-id';
    const mockDescriptor = "wpkh([12345678/84'/0'/0']xpub6CatWdiZiodmUeTDp8LT5or8nmbKNcuyvz7WyksVFkKB4RHwCD3XYuvg9WP3SaFPe5FPnoo1Zv2aq5S5vLLwNVxNP6YnNJvKLzDhPLzfE3e/<0;1>/*)";

    beforeEach(() => {
      mockPrismaClient.wallet.findUnique.mockReset();
      mockPrismaClient.address.findMany.mockReset();
      mockPrismaClient.address.createMany.mockReset();
      (addressDerivation.deriveAddressFromDescriptor as any).mockReset();
      (addressDerivation.deriveAddressFromDescriptor as any).mockImplementation((descriptor: string, index: number, options: any) => {
        const change = options?.change ? 1 : 0;
        return {
          address: `tb1q_test_${change}_${index}`,
          derivationPath: `m/84'/0'/0'/${change}/${index}`,
          publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
        };
      });
    });

    it('should not generate addresses when gap limit is already satisfied', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      // Create 25 receive addresses with the last 20 unused (gap limit = 20)
      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5, // First 5 are used, last 20 are unused
      }));

      // Create 25 change addresses with the last 20 unused (gap limit = 20)
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5, // First 5 are used, last 20 are unused
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should generate addresses when gap limit is not satisfied', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      // Create receive addresses with gap of 10 (need 10 more)
      const receiveAddresses = Array.from({ length: 15 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5, // First 5 used, last 10 unused = gap of 10
      }));

      // Create change addresses with gap of 20 (satisfied)
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5, // First 5 used, last 20 unused = gap of 20
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 10 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should generate 10 more receive addresses to reach gap limit of 20
      // Change addresses already have gap of 20, so none generated for change
      expect(result.length).toBe(10);
      expect(mockPrismaClient.address.createMany).toHaveBeenCalled();
    });

    it('should handle both receive and change addresses separately', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      // Receive addresses with gap of 20 (satisfied)
      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5,
      }));

      // Change addresses with gap of only 5 (not satisfied)
      const changeAddresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5, // 5 used, 5 unused
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 15 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should only generate change addresses (15 more to reach gap of 20)
      expect(result.length).toBe(15);
      // All new addresses should be change addresses (/1/)
      const newChangeAddresses = result.filter(a => a.derivationPath.includes('/1/'));
      expect(newChangeAddresses.length).toBe(15);
    });

    it('should skip wallets without a descriptor', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: null,
        network: 'mainnet',
      });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.findMany).not.toHaveBeenCalled();
    });

    it('should handle wallet with no addresses', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      mockPrismaClient.address.findMany.mockResolvedValue([]);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 40 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // No addresses means gap is 0 for both receive and change
      // Should generate 20 receive + 20 change = 40 addresses
      expect(result).toHaveLength(40);
    });

    it('should handle all addresses being used', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      // All 10 receive addresses are used
      const receiveAddresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: true,
      }));

      // All 10 change addresses are used
      const changeAddresses = Array.from({ length: 10 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: true,
      }));

      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 40 });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      // Should generate 20 receive + 20 change = 40 new addresses
      expect(result.length).toBe(40);
    });

    it('should continue when receive address derivation throws', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i === 0, // trailing unused gap = 19, requires 1 new receive address
      }));
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5, // trailing unused gap = 20, already satisfied
      }));
      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);

      (addressDerivation.deriveAddressFromDescriptor as any).mockImplementationOnce(() => {
        throw new Error('receive derive failed');
      });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should continue when change address derivation throws', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      const receiveAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i < 5, // trailing unused gap = 20, satisfied
      }));
      const changeAddresses = Array.from({ length: 20 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i === 0, // trailing unused gap = 19, requires 1 new change address
      }));
      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);

      (addressDerivation.deriveAddressFromDescriptor as any).mockImplementation((_descriptor: string, _index: number, options: any) => {
        if (options?.change) {
          throw new Error('change derive failed');
        }
        return {
          address: 'tb1q_test_0_25',
          derivationPath: "m/84'/0'/0'/0/25",
          publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
        };
      });

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(0);
      expect(mockPrismaClient.address.createMany).not.toHaveBeenCalled();
    });

    it('should default derived address index to 0 when derivation path has no terminal index', async () => {
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        descriptor: mockDescriptor,
        network: 'mainnet',
      });

      const receiveAddresses = Array.from({ length: 20 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/0/${i}`,
        index: i,
        used: i === 0, // trailing unused gap = 19, requires one new receive address
      }));
      const changeAddresses = Array.from({ length: 25 }, (_, i) => ({
        derivationPath: `m/84'/0'/0'/1/${i}`,
        index: i,
        used: i < 5,
      }));
      mockPrismaClient.address.findMany.mockResolvedValue([...receiveAddresses, ...changeAddresses]);
      mockPrismaClient.address.createMany.mockResolvedValue({ count: 1 });

      (addressDerivation.deriveAddressFromDescriptor as any).mockImplementationOnce(() => ({
        address: 'tb1q_no_index',
        derivationPath: "m/84'/0'/0'/0/",
        publicKey: Buffer.from('02' + '00'.repeat(32), 'hex'),
      }));

      const result = await getBlockchainService().ensureGapLimit(walletId);

      expect(result).toHaveLength(1);
      expect(mockPrismaClient.address.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              address: 'tb1q_no_index',
              index: 0,
            }),
          ]),
        })
      );
    });
  });
}
