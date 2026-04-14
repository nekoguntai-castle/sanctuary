import { beforeEach, describe, expect, it, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../mocks/prisma';

import {
  calculateFeeRate,
  getNetwork,
  getPsbtOutputs,
  parsePsbt,
  PayjoinErrors,
  processPayjoinRequest,
  TEST_ADDRESS_TESTNET,
  validatePsbtStructure,
} from './payjoinServiceTestHarness';

export const registerPayjoinProcessContracts = () => {
  describe('processPayjoinRequest', () => {
    const addressId = 'addr-123';
    const walletId = 'wallet-456';

    const mockAddress = {
      id: addressId,
      address: TEST_ADDRESS_TESTNET,
      wallet: {
        id: walletId,
        network: 'testnet',
        type: 'single_sig',
        scriptType: 'native_segwit',
      },
    };

    const mockUtxos = [
      {
        id: 'utxo-1',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(100000),
        scriptPubKey: '0014' + 'a'.repeat(40),
      },
      {
        id: 'utxo-2',
        txid: 'bbbb'.repeat(16),
        vout: 1,
        amount: BigInt(50000),
        scriptPubKey: '0014' + 'b'.repeat(40),
      },
    ];

    // Create a minimal valid PSBT for testing
    const createMockPsbt = () => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: BigInt(100000),
        },
      });
      psbt.addOutput({
        address: TEST_ADDRESS_TESTNET,
        value: BigInt(80000),
      });
      psbt.addOutput({
        script: bitcoin.payments.p2wpkh({
          hash: Buffer.alloc(20, 1),
          network: bitcoin.networks.testnet,
        }).output!,
        value: BigInt(10000),
      });
      return psbt;
    };

    beforeEach(() => {
      // Reset mocks
      (validatePsbtStructure as Mock).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
        { address: 'tb1q000000000000000000000000000000000000000', value: 10000 },
      ]);
      (calculateFeeRate as Mock).mockReturnValue(10);
    });

    it('should return error for unknown address', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(null);

      const result = await processPayjoinRequest(
        'unknown-address-id',
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.UNAVAILABLE);
      expect(result.errorMessage).toContain('Address not found');
    });

    it('falls back to mainnet when address wallet network is missing', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue({
        ...mockAddress,
        wallet: {
          ...mockAddress.wallet,
          network: undefined,
        },
      });

      const mockPsbt = createMockPsbt();
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
      ]);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(getNetwork).toHaveBeenCalledWith('mainnet');
      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.NOT_ENOUGH_MONEY);
    });

    it('should reject invalid PSBT structure', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (validatePsbtStructure as Mock).mockReturnValue({
        valid: false,
        errors: ['PSBT has no inputs'],
        warnings: [],
      });

      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('no inputs');
    });

    it('should reject PSBT with no output to receiving address', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: 'tb1qdifferentaddress000000000000000000000000', value: 80000 },
      ]);

      // Need to mock parsePsbt
      const mockPsbt = createMockPsbt();
      (parsePsbt as Mock).mockReturnValue(mockPsbt);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('No output to the receiving address');
    });

    it('should return NOT_ENOUGH_MONEY when no suitable UTXOs', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([]); // No UTXOs

      const mockPsbt = createMockPsbt();
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
        { address: 'tb1qchange0000000000000000000000000000000', value: 10000 },
      ]);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.NOT_ENOUGH_MONEY);
    });

    it('should reject PSBT with fee rate below minimum', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (calculateFeeRate as Mock).mockReturnValue(0.5); // Below minimum of 1

      const mockPsbt = createMockPsbt();
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: 80000 },
      ]);

      // Mock UTXO selection
      mockPrismaClient.uTXO.findMany.mockResolvedValue([mockUtxos[0]]);

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.ORIGINAL_PSBT_REJECTED);
      expect(result.errorMessage).toContain('below minimum');
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.address.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.RECEIVER_ERROR);
    });
  });
};
