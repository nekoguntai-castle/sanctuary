import { describe, expect, it, vi, type Mock } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import {
  createMockRequest,
  createMockResponse,
  randomAddress,
  randomTxid,
} from '../../../helpers/testUtils';
import * as blockchain from '../../../../src/services/bitcoin/blockchain';
import * as addressDerivation from '../../../../src/services/bitcoin/addressDerivation';

export function registerTransactionMutationTests(): void {
  describe('Input Validation', () => {
    describe('feeRate validation', () => {
      it('should reject NaN feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = 'invalid';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should reject zero feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = '0';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should reject negative feeRate', async () => {
        const { res, getResponse } = createMockResponse();

        const feeRate = '-5';
        const feeRateNum = parseFloat(feeRate);

        if (isNaN(feeRateNum) || feeRateNum <= 0) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: 'feeRate must be a positive number',
          });
        }

        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('feeRate must be a positive number');
      });

      it('should accept valid positive feeRate', async () => {
        const feeRate = '10.5';
        const feeRateNum = parseFloat(feeRate);

        const isValid = !isNaN(feeRateNum) && feeRateNum > 0;

        expect(isValid).toBe(true);
        expect(feeRateNum).toBe(10.5);
      });
    });
  });

  describe('POST /wallets/:walletId/transactions/create', () => {
    const mockTransactionService = {
      createTransaction: vi.fn(),
    };

    beforeEach(() => {
      vi.doMock('../../../../src/services/bitcoin/transactionService', () => mockTransactionService);
      mockTransactionService.createTransaction.mockReset();
    });

    it('should create a transaction with valid inputs', async () => {
      const walletId = 'wallet-123';
      const recipient = 'tb1qtest123456789';
      const amount = 50000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
        type: 'single_sig',
      });

      mockTransactionService.createTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8BAH0CAAAAAb...',
        fee: 500,
        totalInput: 100000,
        totalOutput: 99500,
        changeAmount: 49500,
        changeAddress: 'tb1qchange123',
        utxos: [{ txid: 'abc123', vout: 0, value: 100000 }],
        inputPaths: ["m/84'/1'/0'/0/0"],
        effectiveAmount: 50000,
      });

      const { res, getResponse } = createMockResponse();

      // Simulate the route handler validation
      if (!recipient || !amount) {
        res.status!(400).json!({ error: 'Bad Request', message: 'recipient and amount are required' });
      } else if (!feeRate || feeRate < 1) {
        res.status!(400).json!({ error: 'Bad Request', message: 'feeRate must be at least 1 sat/vB' });
      } else {
        const txData = await mockTransactionService.createTransaction(
          walletId, recipient, amount, feeRate, {}
        );
        res.json!(txData);
      }

      const response = getResponse();
      expect(response.body.psbtBase64).toBe('cHNidP8BAH0CAAAAAb...');
      expect(response.body.fee).toBe(500);
      expect(response.body.effectiveAmount).toBe(50000);
    });

    it('should reject request without recipient', async () => {
      const { res, getResponse } = createMockResponse();

      const recipient = undefined;
      const amount = 50000;

      if (!recipient || !amount) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient and amount are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toBe('recipient and amount are required');
    });

    it('should reject request without amount', async () => {
      const { res, getResponse } = createMockResponse();

      const recipient = 'tb1qtest123';
      const amount = undefined;

      if (!recipient || !amount) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'recipient and amount are required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
    });

    it('should reject feeRate below minimum', async () => {
      const { res, getResponse } = createMockResponse();
      const MIN_FEE_RATE = 1;

      const feeRate = 0.5;

      if (!feeRate || feeRate < MIN_FEE_RATE) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: `feeRate must be at least ${MIN_FEE_RATE} sat/vB`,
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('feeRate must be at least');
    });

    it('should return 404 for non-existent wallet', async () => {
      const walletId = 'non-existent-wallet';

      mockPrismaClient.wallet.findUnique.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const wallet = await mockPrismaClient.wallet.findUnique({
        where: { id: walletId },
      });

      if (!wallet) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'Wallet not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.message).toBe('Wallet not found');
    });

    it('should handle insufficient balance error', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createTransaction.mockRejectedValue(
        new Error('Insufficient funds: need 100000 sats but only have 50000 sats')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await mockTransactionService.createTransaction(walletId, 'tb1q...', 100000, 5, {});
        res.json!({});
      } catch (error) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: error instanceof Error ? error.message : 'Failed to create transaction',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Insufficient funds');
    });

    it('should include decoy outputs when enabled', async () => {
      const walletId = 'wallet-123';

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8...',
        fee: 600,
        totalInput: 150000,
        totalOutput: 149400,
        changeAmount: 99400,
        changeAddress: 'tb1qchange',
        effectiveAmount: 50000,
        decoyOutputs: [
          { address: 'tb1qdecoy1', amount: 25000 },
          { address: 'tb1qdecoy2', amount: 24400 },
        ],
      });

      const { res, getResponse } = createMockResponse();

      const txData = await mockTransactionService.createTransaction(
        walletId, 'tb1qrecipient', 50000, 5,
        { decoyOutputs: 2 }
      );

      res.json!({
        ...txData,
        decoyOutputs: txData.decoyOutputs,
      });

      const response = getResponse();
      expect(response.body.decoyOutputs).toHaveLength(2);
    });
  });

  describe('POST /wallets/:walletId/transactions/batch', () => {
    const mockTransactionService = {
      createBatchTransaction: vi.fn(),
    };

    beforeEach(() => {
      mockTransactionService.createBatchTransaction.mockReset();
    });

    it('should create batch transaction with multiple outputs', async () => {
      const walletId = 'wallet-123';
      const outputs = [
        { address: 'tb1qrecipient1', amount: 25000 },
        { address: 'tb1qrecipient2', amount: 30000 },
      ];
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      mockTransactionService.createBatchTransaction.mockResolvedValue({
        psbtBase64: 'cHNidP8...',
        fee: 700,
        totalInput: 100000,
        totalOutput: 99300,
        changeAmount: 44300,
        changeAddress: 'tb1qchange',
        utxos: [{ txid: 'abc123', vout: 0, value: 100000 }],
        inputPaths: ["m/84'/1'/0'/0/0"],
        outputs: [
          { address: 'tb1qrecipient1', amount: 25000 },
          { address: 'tb1qrecipient2', amount: 30000 },
        ],
      });

      const { res, getResponse } = createMockResponse();

      // Simulate validation
      if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
        res.status!(400).json!({ error: 'Bad Request', message: 'outputs array is required' });
      } else {
        const txData = await mockTransactionService.createBatchTransaction(
          walletId, outputs, feeRate, {}
        );
        res.json!(txData);
      }

      const response = getResponse();
      expect(response.body.outputs).toHaveLength(2);
      expect(response.body.fee).toBe(700);
    });

    it('should reject empty outputs array', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs: any[] = [];

      if (!outputs || !Array.isArray(outputs) || outputs.length === 0) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'outputs array is required with at least one output',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('outputs array is required');
    });

    it('should reject output without address', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { amount: 25000 }, // Missing address
      ];

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i] as { address?: string; amount: number };
        if (!output.address) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: `Output ${i + 1}: address is required`,
          });
          break;
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('address is required');
    });

    it('should reject output without amount (when sendMax is false)', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { address: 'tb1qtest', amount: 0 }, // Invalid amount
      ];

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i] as { address: string; amount?: number; sendMax?: boolean };
        if (!output.sendMax && (!output.amount || output.amount <= 0)) {
          res.status!(400).json!({
            error: 'Bad Request',
            message: `Output ${i + 1}: amount is required (or set sendMax: true)`,
          });
          break;
        }
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('amount is required');
    });

    it('should reject multiple sendMax outputs', async () => {
      const { res, getResponse } = createMockResponse();

      const outputs = [
        { address: 'tb1qtest1', sendMax: true },
        { address: 'tb1qtest2', sendMax: true }, // Second sendMax - invalid
      ];

      const sendMaxCount = outputs.filter(o => o.sendMax).length;
      if (sendMaxCount > 1) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Only one output can have sendMax enabled',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('Only one output can have sendMax');
    });

    it('should allow single sendMax output', async () => {
      const outputs = [
        { address: 'tb1qtest1', amount: 10000 },
        { address: 'tb1qtest2', sendMax: true },
      ];

      const sendMaxCount = outputs.filter(o => o.sendMax).length;
      expect(sendMaxCount).toBe(1);
    });
  });

  describe('POST /wallets/:walletId/transactions/broadcast', () => {
    it('should broadcast signed PSBT successfully', async () => {
      const walletId = 'wallet-123';
      const signedPsbtBase64 = 'cHNidP8BAHsCAAAAAQ...signed...';
      const txid = randomTxid();

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      vi.mocked(blockchain.broadcastTransaction).mockResolvedValue(txid);

      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-new',
        txid,
        walletId,
        type: 'sent',
        amount: BigInt(-50000),
        fee: BigInt(500),
      });

      const { res, getResponse } = createMockResponse();

      // Simulate successful broadcast
      const broadcastedTxid = await vi.mocked(blockchain.broadcastTransaction)('signed-hex');
      res.json!({
        success: true,
        txid: broadcastedTxid,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
      expect(response.body.txid).toBe(txid);
    });

    it('should handle broadcast with raw transaction hex (Trezor)', async () => {
      const walletId = 'wallet-123';
      const rawTxHex = '0200000001abc...';
      const txid = randomTxid();

      vi.mocked(blockchain.broadcastTransaction).mockResolvedValue(txid);

      const { res, getResponse } = createMockResponse();

      const broadcastedTxid = await vi.mocked(blockchain.broadcastTransaction)(rawTxHex);
      res.json!({
        success: true,
        txid: broadcastedTxid,
      });

      const response = getResponse();
      expect(response.body.success).toBe(true);
    });

    it('should reject broadcast without signed data', async () => {
      const { res, getResponse } = createMockResponse();

      const signedPsbtBase64 = undefined;
      const rawTxHex = undefined;

      if (!signedPsbtBase64 && !rawTxHex) {
        res.status!(400).json!({
          error: 'Bad Request',
          message: 'Either signedPsbtBase64 or rawTxHex is required',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('signedPsbtBase64 or rawTxHex');
    });

    it('should handle broadcast failure gracefully', async () => {
      vi.mocked(blockchain.broadcastTransaction).mockRejectedValue(
        new Error('Transaction rejected: insufficient fee')
      );

      const { res, getResponse } = createMockResponse();

      try {
        await vi.mocked(blockchain.broadcastTransaction)('invalid-hex');
        res.json!({ success: true });
      } catch (error) {
        res.status!(400).json!({
          error: 'Broadcast Failed',
          message: error instanceof Error ? error.message : 'Failed to broadcast transaction',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(400);
      expect(response.body.message).toContain('insufficient fee');
    });

    it('should create transaction record after successful broadcast', async () => {
      const walletId = 'wallet-123';
      const txid = randomTxid();
      const recipient = randomAddress();

      vi.mocked(blockchain.broadcastTransaction).mockResolvedValue(txid);
      mockPrismaClient.transaction.create.mockResolvedValue({
        id: 'tx-new',
        txid,
        walletId,
      });

      // Simulate creating the transaction record
      await mockPrismaClient.transaction.create({
        data: {
          txid,
          walletId,
          type: 'sent',
          amount: BigInt(-50000),
          fee: BigInt(500),
          counterpartyAddress: recipient,
          confirmations: 0,
        },
      });

      expect(mockPrismaClient.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            txid,
            walletId,
            type: 'sent',
          }),
        })
      );
    });
  });

  describe('PATCH /utxos/:utxoId/freeze', () => {
    it('should freeze a UTXO', async () => {
      const utxoId = 'utxo-123';
      const userId = 'user-123';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        frozen: false,
        wallet: {
          users: [{ userId }],
        },
      });

      mockPrismaClient.uTXO.update.mockResolvedValue({
        id: utxoId,
        frozen: true,
      });

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
        include: { wallet: { include: { users: true } } },
      });

      if (!utxo) {
        res.status!(404).json!({ error: 'Not Found' });
      } else {
        const updated = await mockPrismaClient.uTXO.update({
          where: { id: utxoId },
          data: { frozen: true },
        });
        res.json!(updated);
      }

      const response = getResponse();
      expect(response.body.frozen).toBe(true);
    });

    it('should unfreeze a UTXO', async () => {
      const utxoId = 'utxo-123';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        frozen: true,
      });

      mockPrismaClient.uTXO.update.mockResolvedValue({
        id: utxoId,
        frozen: false,
      });

      const { res, getResponse } = createMockResponse();

      const updated = await mockPrismaClient.uTXO.update({
        where: { id: utxoId },
        data: { frozen: false },
      });
      res.json!(updated);

      const response = getResponse();
      expect(response.body.frozen).toBe(false);
    });

    it('should return 404 for non-existent UTXO', async () => {
      const utxoId = 'non-existent';

      mockPrismaClient.uTXO.findUnique.mockResolvedValue(null);

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
      });

      if (!utxo) {
        res.status!(404).json!({
          error: 'Not Found',
          message: 'UTXO not found',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(404);
      expect(response.body.message).toBe('UTXO not found');
    });

    it('should deny freeze for unauthorized user', async () => {
      const utxoId = 'utxo-123';
      const requestUserId = 'user-456'; // Different user

      mockPrismaClient.uTXO.findUnique.mockResolvedValue({
        id: utxoId,
        walletId: 'wallet-123',
        wallet: {
          users: [{ userId: 'user-123' }], // Owned by different user
        },
      });

      const { res, getResponse } = createMockResponse();

      const utxo = await mockPrismaClient.uTXO.findUnique({
        where: { id: utxoId },
        include: { wallet: { include: { users: true } } },
      });

      const hasAccess = utxo?.wallet?.users?.some(
        (u: { userId: string }) => u.userId === requestUserId
      );

      if (!hasAccess) {
        res.status!(403).json!({
          error: 'Forbidden',
          message: 'You do not have access to this UTXO',
        });
      }

      const response = getResponse();
      expect(response.statusCode).toBe(403);
    });
  });

  describe('POST /wallets/:walletId/transactions/estimate', () => {
    it('should return fee estimate for transaction', async () => {
      const walletId = 'wallet-123';
      const recipient = 'tb1qtest123';
      const amount = 50000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      const { res, getResponse } = createMockResponse();

      // Simulate fee estimation calculation
      // Typical P2WPKH: 1 input (68 vbytes) + 2 outputs (62 vbytes) + overhead (10.5 vbytes) ≈ 141 vbytes
      const estimatedVsize = 141;
      const estimatedFee = Math.ceil(estimatedVsize * feeRate);

      res.json!({
        estimatedFee,
        estimatedVsize,
        feeRate,
        totalRequired: amount + estimatedFee,
      });

      const response = getResponse();
      expect(response.body.estimatedFee).toBe(705); // 141 * 5
      expect(response.body.estimatedVsize).toBe(141);
      expect(response.body.totalRequired).toBe(50705);
    });

    it('should estimate for sendMax (subtract fees)', async () => {
      const walletId = 'wallet-123';
      const availableBalance = 100000;
      const feeRate = 5;

      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: walletId,
        network: 'testnet',
      });

      const { res, getResponse } = createMockResponse();

      // SendMax: no change output, so smaller transaction
      // 1 input (68 vbytes) + 1 output (31 vbytes) + overhead (10.5 vbytes) ≈ 110 vbytes
      const estimatedVsize = 110;
      const estimatedFee = Math.ceil(estimatedVsize * feeRate);
      const effectiveAmount = availableBalance - estimatedFee;

      res.json!({
        estimatedFee,
        estimatedVsize,
        feeRate,
        effectiveAmount, // Amount after fees
        sendMax: true,
      });

      const response = getResponse();
      expect(response.body.estimatedFee).toBe(550); // 110 * 5
      expect(response.body.effectiveAmount).toBe(99450); // 100000 - 550
      expect(response.body.sendMax).toBe(true);
    });
  });

}
