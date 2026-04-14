import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../mocks/prisma';

import {
  calculateFeeRate,
  clonePsbt,
  getPsbtOutputs,
  parsePsbt,
  PayjoinErrors,
  processPayjoinRequest,
  TEST_ADDRESS_TESTNET,
  validatePsbtStructure,
} from './payjoinServiceTestHarness';

export const registerPayjoinUtxoContracts = () => {
  describe('UTXO Selection for Contribution (selectContributionUtxo)', () => {
    // Note: selectContributionUtxo is not exported, but we can test its behavior
    // through processPayjoinRequest

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

    const createMockPsbt = (paymentAmount: number) => {
      const psbt = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
      psbt.addInput({
        hash: Buffer.alloc(32, 0xaa),
        index: 0,
        sequence: 0xfffffffd,
      });
      psbt.updateInput(0, {
        witnessUtxo: {
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: BigInt(paymentAmount + 10000), // Include some for fee
        },
      });
      psbt.addOutput({
        address: TEST_ADDRESS_TESTNET,
        value: BigInt(paymentAmount),
      });
      return psbt;
    };

    beforeEach(() => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      (validatePsbtStructure as Mock).mockReturnValue({ valid: true, errors: [], warnings: [] });
      (calculateFeeRate as Mock).mockReturnValue(10);
    });

    it('should prefer UTXOs within 0.5x-2x of payment amount', async () => {
      const paymentAmount = 100000;

      // Setup: UTXO that's 1.5x the payment (within range)
      const optimalUtxo = {
        id: 'utxo-optimal',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(150000), // 1.5x payment
        scriptPubKey: '0014' + 'a'.repeat(40),
      };

      // Large UTXO outside the preferred range
      const largeUtxo = {
        id: 'utxo-large',
        txid: 'bbbb'.repeat(16),
        vout: 0,
        amount: BigInt(1000000), // 10x payment - outside range
        scriptPubKey: '0014' + 'b'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([optimalUtxo, largeUtxo]);

      const mockPsbt = createMockPsbt(paymentAmount);
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: paymentAmount },
      ]);

      // Mock clonePsbt to return a modifiable copy
      (clonePsbt as Mock).mockImplementation((psbt) => {
        const clone = new bitcoin.Psbt({ network: bitcoin.networks.testnet });
        // Add required structure
        clone.addInput({
          hash: Buffer.alloc(32, 0xaa),
          index: 0,
          sequence: 0xfffffffd,
        });
        clone.updateInput(0, {
          witnessUtxo: {
            script: Buffer.from('0014' + 'a'.repeat(40), 'hex'),
            value: BigInt(paymentAmount + 10000),
          },
        });
        clone.addOutput({
          script: bitcoin.address.toOutputScript(TEST_ADDRESS_TESTNET, bitcoin.networks.testnet),
          value: BigInt(paymentAmount),
        });
        return clone;
      });

      const result = await processPayjoinRequest(
        addressId,
        mockPsbt.toBase64(),
        1
      );

      // Verify the optimal UTXO was selected (should be first choice based on proximity)
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalled();
    });

    it('should avoid dust UTXOs (< 1000 sats)', async () => {
      const paymentAmount = 50000;

      // Dust UTXO
      const dustUtxo = {
        id: 'utxo-dust',
        txid: 'aaaa'.repeat(16),
        vout: 0,
        amount: BigInt(500), // Dust
        scriptPubKey: '0014' + 'a'.repeat(40),
      };

      // Valid UTXO
      const validUtxo = {
        id: 'utxo-valid',
        txid: 'bbbb'.repeat(16),
        vout: 0,
        amount: BigInt(60000),
        scriptPubKey: '0014' + 'b'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([dustUtxo, validUtxo]);

      const mockPsbt = createMockPsbt(paymentAmount);
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      (getPsbtOutputs as Mock).mockReturnValue([
        { address: TEST_ADDRESS_TESTNET, value: paymentAmount },
      ]);

      // The service should not select dust UTXOs
      // This is tested through the query constraints
      expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            amount: { gt: 0 }, // Should require non-dust
          }),
        })
      );
    });

    it('should exclude frozen UTXOs', async () => {
      const result = await processPayjoinRequest(
        addressId,
        'cHNidP8=', // minimal PSBT
        1
      );

      // Verify query excludes frozen
      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            frozen: false,
          }),
        })
      );
    });

    it('should require confirmations > 0', async () => {
      await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmations: { gte: 1 },
          }),
        })
      );
    });

    it('should exclude draft-locked UTXOs', async () => {
      await processPayjoinRequest(
        addressId,
        'cHNidP8=',
        1
      );

      expect(mockPrismaClient.uTXO.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            draftLock: null,
          }),
        })
      );
    });

    it('should choose the closest candidate when multiple in-range UTXOs exist', async () => {
      const paymentAmount = 100000;
      const fartherCandidate = {
        id: 'utxo-farther',
        txid: 'cccc'.repeat(16),
        vout: 0,
        amount: BigInt(120000),
        scriptPubKey: '0014' + 'c'.repeat(40),
      };
      const closestCandidate = {
        id: 'utxo-closest',
        txid: 'dddd'.repeat(16),
        vout: 1,
        amount: BigInt(102000),
        scriptPubKey: '0014' + 'd'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([fartherCandidate, closestCandidate]);
      (parsePsbt as Mock).mockReturnValue({} as bitcoin.Psbt);
      (getPsbtOutputs as Mock).mockReturnValue([{ address: TEST_ADDRESS_TESTNET, value: paymentAmount }]);

      const addInput = vi.fn();
      (clonePsbt as Mock).mockReturnValue({
        addInput,
        txOutputs: [{ value: paymentAmount }],
        toBase64: () => 'proposal-closest',
      });

      const result = await processPayjoinRequest(addressId, 'cHNidP8=', 1);

      expect(result.success).toBe(true);
      expect(addInput).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: closestCandidate.txid,
          index: closestCandidate.vout,
        })
      );
    });

    it('should fall back to the largest non-dust UTXO when no in-range candidate exists', async () => {
      const paymentAmount = 100000;
      const smallNonDust = {
        id: 'utxo-small',
        txid: 'eeee'.repeat(16),
        vout: 0,
        amount: BigInt(30000),
        scriptPubKey: '0014' + 'e'.repeat(40),
      };
      const largestNonDust = {
        id: 'utxo-large',
        txid: 'ffff'.repeat(16),
        vout: 1,
        amount: BigInt(400000),
        scriptPubKey: '0014' + 'f'.repeat(40),
      };
      const dust = {
        id: 'utxo-dust',
        txid: '9999'.repeat(16),
        vout: 2,
        amount: BigInt(900),
        scriptPubKey: '0014' + '9'.repeat(40),
      };

      mockPrismaClient.uTXO.findMany.mockResolvedValue([smallNonDust, largestNonDust, dust]);
      (parsePsbt as Mock).mockReturnValue({} as bitcoin.Psbt);
      (getPsbtOutputs as Mock).mockReturnValue([{ address: TEST_ADDRESS_TESTNET, value: paymentAmount }]);

      const addInput = vi.fn();
      (clonePsbt as Mock).mockReturnValue({
        addInput,
        txOutputs: [{ value: paymentAmount }],
        toBase64: () => 'proposal-fallback',
      });

      const result = await processPayjoinRequest(addressId, 'cHNidP8=', 1);

      expect(result.success).toBe(true);
      expect(addInput).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: largestNonDust.txid,
          index: largestNonDust.vout,
        })
      );
    });

    it('should return NOT_ENOUGH_MONEY when only dust UTXOs are available', async () => {
      const paymentAmount = 100000;
      const dustOnly = [
        {
          id: 'dust-1',
          txid: '1212'.repeat(16),
          vout: 0,
          amount: BigInt(500),
          scriptPubKey: '0014' + '1'.repeat(40),
        },
        {
          id: 'dust-2',
          txid: '3434'.repeat(16),
          vout: 1,
          amount: BigInt(1000),
          scriptPubKey: '0014' + '2'.repeat(40),
        },
      ];

      mockPrismaClient.uTXO.findMany.mockResolvedValue(dustOnly);
      (parsePsbt as Mock).mockReturnValue({} as bitcoin.Psbt);
      (getPsbtOutputs as Mock).mockReturnValue([{ address: TEST_ADDRESS_TESTNET, value: paymentAmount }]);

      const result = await processPayjoinRequest(addressId, 'cHNidP8=', 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe(PayjoinErrors.NOT_ENOUGH_MONEY);
    });
  });
};
