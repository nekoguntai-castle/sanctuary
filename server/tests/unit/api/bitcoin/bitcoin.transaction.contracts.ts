import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool } from '../../../mocks/electrum';
import {
  app,
  mockAdvancedTx,
  mockBlockchain,
  mockMempool,
  mockNodeClient,
  mockUtils,
  request,
} from './bitcoinTestHarness';

export const registerBitcoinTransactionRouteTests = () => {
  describe('Transaction Routes', () => {
    describe('GET /bitcoin/transaction/:txid', () => {
      it('should return transaction details', async () => {
        const txDetails = {
          txid: 'abc123',
          confirmations: 6,
          size: 250,
          fee: 5000,
        };
        mockBlockchain.getTransactionDetails.mockResolvedValue(txDetails);

        const response = await request(app).get('/bitcoin/transaction/abc123');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(txDetails);
        expect(mockBlockchain.getTransactionDetails).toHaveBeenCalledWith('abc123', 'mainnet');
      });

      it('should pass query network to transaction details', async () => {
        const txDetails = { txid: 'abc123', confirmations: 0 };
        mockBlockchain.getTransactionDetails.mockResolvedValue(txDetails);

        const response = await request(app).get('/bitcoin/transaction/abc123?network=testnet4');

        expect(response.status).toBe(200);
        expect(mockBlockchain.getTransactionDetails).toHaveBeenCalledWith('abc123', 'testnet4');
      });

      it('should return 500 when transaction not found', async () => {
        mockBlockchain.getTransactionDetails.mockRejectedValue(new Error('Not found'));

        const response = await request(app).get('/bitcoin/transaction/nonexistent');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/broadcast', () => {
      it('should broadcast raw transaction', async () => {
        mockBlockchain.broadcastTransaction.mockResolvedValue({
          txid: 'newtxid123',
          success: true,
        });

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('txid', 'newtxid123');
        expect(mockBlockchain.broadcastTransaction).toHaveBeenCalledWith('0200000001...', 'mainnet');
      });

      it('should broadcast raw transaction on requested network', async () => {
        mockBlockchain.broadcastTransaction.mockResolvedValue({
          txid: 'newtxid123',
          success: true,
        });

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...', network: 'signet' });

        expect(response.status).toBe(200);
        expect(mockBlockchain.broadcastTransaction).toHaveBeenCalledWith('0200000001...', 'signet');
      });

      it('should return 400 when broadcast network is invalid', async () => {
        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...', network: 'invalid' });

        expect(response.status).toBe(400);
        expect(mockBlockchain.broadcastTransaction).not.toHaveBeenCalled();
      });

      it('should return 400 when rawTx is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({});

        expect(response.status).toBe(400);
        expect(response.body).toHaveProperty('message', 'rawTx is required');
      });

      it('should return 500 on broadcast error', async () => {
        mockBlockchain.broadcastTransaction.mockRejectedValue(new Error('Invalid transaction'));

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: 'invalid' });

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf-check', () => {
      it('should check if transaction can be replaced', async () => {
        mockAdvancedTx.canReplaceTransaction.mockResolvedValue({
          canReplace: true,
          currentFeeRate: 10,
          minimumNewFeeRate: 11,
        });

        const response = await request(app).post('/bitcoin/transaction/abc123/rbf-check');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('canReplace', true);
        expect(mockAdvancedTx.canReplaceTransaction).toHaveBeenCalledWith('abc123', 'mainnet');
      });

      it('should check RBF eligibility on requested network', async () => {
        mockAdvancedTx.canReplaceTransaction.mockResolvedValue({
          canReplace: true,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf-check')
          .send({ network: 'testnet' });

        expect(response.status).toBe(200);
        expect(mockAdvancedTx.canReplaceTransaction).toHaveBeenCalledWith('abc123', 'testnet3');
      });

      it('should return 500 on error', async () => {
        mockAdvancedTx.canReplaceTransaction.mockRejectedValue(new Error('Failed'));

        const response = await request(app).post('/bitcoin/transaction/abc123/rbf-check');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf', () => {
      it('should create RBF transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'testnet4',
        });
        mockAdvancedTx.createRBFTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'base64psbt' },
          fee: 6000,
          feeRate: 24,
          feeDelta: 1000,
          inputs: [],
          outputs: [],
          inputPaths: [],
        });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'base64psbt');
        expect(mockAdvancedTx.createRBFTransaction).toHaveBeenCalledWith(
          'abc123',
          24,
          'wallet-1',
          'testnet4'
        );
      });

      it('should return 400 when newFeeRate is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when walletId is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24 });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(403);
      });

      it('should return 500 when RBF creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(new Error('rbf failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });

      it('should return 400 when wallet network is unsupported', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'unsupported',
        });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
        expect(mockAdvancedTx.createRBFTransaction).not.toHaveBeenCalled();
      });
    });

    describe('POST /bitcoin/transaction/cpfp', () => {
      it('should create CPFP transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'testnet' });
        mockAdvancedTx.createCPFPTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'cpfppsbt' },
          childFee: 3000,
          childFeeRate: 30,
          parentFeeRate: 5,
          effectiveFeeRate: 20,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'cpfppsbt');
        expect(response.body).toHaveProperty('effectiveFeeRate', 20);
        expect(mockAdvancedTx.createCPFPTransaction).toHaveBeenCalledWith(
          'parent123',
          0,
          30,
          'bc1qtest',
          'wallet-1',
          'testnet3'
        );
      });

      it('should return 400 when required params are missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({ parentTxid: 'parent123' });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(403);
      });

      it('should return 500 when CPFP creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createCPFPTransaction.mockRejectedValue(new Error('cpfp failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });
    });

    describe('POST /bitcoin/transaction/batch', () => {
      it('should create batch transaction', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'signet' });
        mockAdvancedTx.createBatchTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'batchpsbt' },
          fee: 10000,
          totalInput: 1000000,
          totalOutput: 990000,
          changeAmount: 490000,
          savedFees: 2000,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [
              { address: 'bc1qtest1', amount: 250000 },
              { address: 'bc1qtest2', amount: 250000 },
            ],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'batchpsbt');
        expect(response.body).toHaveProperty('recipientCount', 2);
        expect(mockAdvancedTx.createBatchTransaction).toHaveBeenCalledWith(
          [
            { address: 'bc1qtest1', amount: 250000 },
            { address: 'bc1qtest2', amount: 250000 },
          ],
          20,
          'wallet-1',
          undefined,
          'signet'
        );
      });

      it('should return 400 when recipients is empty', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({ recipients: [], feeRate: 20, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipients is not an array', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({ recipients: 'invalid', feeRate: 20, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipient lacks address', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
      });

      it('should return 400 when recipient lacks amount', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest' }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(403);
      });

      it('should return 500 when batch creation fails', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createBatchTransaction.mockRejectedValue(new Error('batch failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });
    });
  });
};
