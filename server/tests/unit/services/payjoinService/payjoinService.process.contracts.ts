import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import { mockPrismaClient } from '../../../mocks/prisma';

import {
  mockAssertWalletHardwareCapabilityById,
  calculateFeeRate,
  clonePsbt,
  getNetwork,
  getPsbtOutputs,
  parsePsbt,
  PayjoinErrors,
  processPayjoinRequest,
  TEST_ADDRESS_TESTNET,
  validatePsbtStructure,
} from './payjoinServiceTestHarness';
import { ForbiddenError } from '../../../../src/errors';

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

    // Create a minimal valid BIP78 original (finalized, with UTXO data) for testing
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
      // Placeholder witness: the receiver checks finalization, not the signature.
      psbt.data.inputs[0].finalScriptWitness = Buffer.from('0201aa0102', 'hex');
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

    it.each(['ledger', 'jade', 'trezor', 'watch_only'])(
      'blocks %s receiver proposal construction before UTXO selection',
      async type => {
        mockAssertWalletHardwareCapabilityById.mockRejectedValueOnce(
          new ForbiddenError('blocked'),
        );
        mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
        mockPrismaClient.wallet.findUnique.mockResolvedValue({
          id: walletId,
          devices: [{ device: { type, model: null } }],
        });

        const result = await processPayjoinRequest(addressId, 'cHNidP8=', 1);

        expect(result.success).toBe(false);
        expect(result.error).toBe(PayjoinErrors.RECEIVER_ERROR);
        expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalled();
      },
    );

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

    it('fails closed with BIP78 unavailable instead of returning an uncredited, unsigned proposal', async () => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([mockUtxos[0]]);
      const mockPsbt = createMockPsbt();
      (parsePsbt as Mock).mockReturnValue(mockPsbt);
      const addInput = vi.fn();
      (clonePsbt as Mock).mockImplementation((psbt: bitcoin.Psbt) => Object.assign(psbt.clone(), { addInput }));

      const result = await processPayjoinRequest(addressId, mockPsbt.toBase64(), 1);

      expect(result).toEqual({
        success: false,
        error: PayjoinErrors.UNAVAILABLE,
        errorMessage: 'Payjoin receiver proposals are unavailable until receiver input signing is implemented',
      });
      expect(result.proposalPsbt).toBeUndefined();
      expect(clonePsbt).not.toHaveBeenCalled();
      expect(addInput).not.toHaveBeenCalled();
    });

    it.each([
      ['an unfinalized original', (psbt: bitcoin.Psbt) => { delete psbt.data.inputs[0].finalScriptWitness; }],
      ['an original input without UTXO data', (psbt: bitcoin.Psbt) => { delete psbt.data.inputs[0].witnessUtxo; }],
    ])('rejects %s before contribution selection', async (_name, edit) => {
      mockPrismaClient.address.findUnique.mockResolvedValue(mockAddress);
      mockPrismaClient.uTXO.findMany.mockResolvedValue([mockUtxos[0]]);
      const mockPsbt = createMockPsbt();
      edit(mockPsbt);
      (parsePsbt as Mock).mockReturnValue(mockPsbt);

      const result = await processPayjoinRequest(addressId, mockPsbt.toBase64(), 1);

      expect(result).toEqual({
        success: false,
        error: PayjoinErrors.ORIGINAL_PSBT_REJECTED,
        errorMessage: 'Original PSBT input 0 must be finalized and carry UTXO data',
      });
      expect(mockPrismaClient.uTXO.findMany).not.toHaveBeenCalled();
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
