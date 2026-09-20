import { describe, expect, it, vi } from 'vitest';
import { InvalidInputError } from '../../../../src/errors/ApiError';
import { buildWalletEditAccessWhere } from '../../../../src/repositories/accessControl';
import { mockPrismaClient } from '../../../mocks/prisma';
import { mockElectrumClient, mockElectrumPool } from '../../../mocks/electrum';
import {
  app,
  mockAdvancedTx,
  mockBlockchain,
  mockMempool,
  mockNodeClient,
  mockUtils,
  mockAssertWalletHardwareCapabilityById,
  request,
} from './bitcoinTestHarness';

function expectGroupAwareEditLookup(): void {
  expect(mockPrismaClient.wallet.findFirst).toHaveBeenCalledWith({
    where: { id: 'wallet-1', ...buildWalletEditAccessWhere('test-user-id') },
  });
}

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

      it('should normalize the legacy testnet query for transaction details', async () => {
        const txDetails = { txid: 'abc123', confirmations: 0 };
        mockBlockchain.getTransactionDetails.mockResolvedValue(txDetails);

        const response = await request(app).get('/bitcoin/transaction/abc123?network=testnet');

        expect(response.status).toBe(200);
        expect(mockBlockchain.getTransactionDetails).toHaveBeenCalledWith('abc123', 'testnet3');
      });

      it('should return 500 when transaction not found', async () => {
        mockBlockchain.getTransactionDetails.mockRejectedValue(new Error('Not found'));

        const response = await request(app).get('/bitcoin/transaction/nonexistent');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/broadcast', () => {
      it('blocks unscoped raw transaction broadcast before the network boundary', async () => {
        mockBlockchain.broadcastTransaction.mockResolvedValue({
          txid: 'newtxid123',
          success: true,
        });

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...' });

        expect(response.status).toBe(403);
        expect(response.body.details).toMatchObject({
          capability: 'broadcast',
          source: 'unscoped_raw_transaction',
        });
        expect(mockBlockchain.broadcastTransaction).not.toHaveBeenCalled();
      });

      it('blocks unscoped raw transaction broadcast on an explicit network', async () => {
        mockBlockchain.broadcastTransaction.mockResolvedValue({
          txid: 'newtxid123',
          success: true,
        });

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: '0200000001...', network: 'signet' });

        expect(response.status).toBe(403);
        expect(mockBlockchain.broadcastTransaction).not.toHaveBeenCalled();
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

      it('does not reach a failing broadcaster while the kill switch is active', async () => {
        mockBlockchain.broadcastTransaction.mockRejectedValue(new Error('Invalid transaction'));

        const response = await request(app)
          .post('/bitcoin/broadcast')
          .send({ rawTx: 'invalid' });

        expect(response.status).toBe(403);
        expect(mockBlockchain.broadcastTransaction).not.toHaveBeenCalled();
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf-check', () => {
      it('should check if transaction can be replaced', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          network: 'testnet4',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.canReplaceTransaction.mockResolvedValue({
          canReplace: true,
          currentFeeRate: 10,
          minimumNewFeeRate: 11,
        });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf-check')
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('canReplace', true);
        expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalledWith({
          where: {
            txid_walletId: { txid: 'abc123', walletId: 'wallet-1' },
          },
        });
        expect(mockAdvancedTx.canReplaceTransaction).toHaveBeenCalledWith('abc123', 'testnet4');
      });

      it('should return 400 when walletId is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf-check');

        expect(response.status).toBe(400);
        expect(mockAdvancedTx.canReplaceTransaction).not.toHaveBeenCalled();
      });

      it('should return 403 when user lacks wallet permission', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf-check')
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(403);
        expect(mockAdvancedTx.canReplaceTransaction).not.toHaveBeenCalled();
      });

      it('should return 404 when the transaction is not in the wallet', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf-check')
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(404);
        expect(mockAdvancedTx.canReplaceTransaction).not.toHaveBeenCalled();
      });

      it('should normalize uppercase hex transaction ids before scoped lookup', async () => {
        const uppercaseTxid = 'A'.repeat(64);
        const normalizedTxid = uppercaseTxid.toLowerCase();
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.canReplaceTransaction.mockResolvedValue({ canReplace: true });

        const response = await request(app)
          .post(`/bitcoin/transaction/${uppercaseTxid}/rbf-check`)
          .send({ walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(mockPrismaClient.transaction.findUnique).toHaveBeenCalledWith({
          where: {
            txid_walletId: { txid: normalizedTxid, walletId: 'wallet-1' },
          },
        });
        expect(mockAdvancedTx.canReplaceTransaction).toHaveBeenCalledWith(
          normalizedTxid,
          'mainnet'
        );
      });
    });

    describe('POST /bitcoin/transaction/:txid/rbf', () => {
      it('should create RBF transaction', async () => {
        const uppercaseTxid = 'B'.repeat(64);
        const normalizedTxid = uppercaseTxid.toLowerCase();
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'testnet4',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
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
          .post(`/bitcoin/transaction/${uppercaseTxid}/rbf`)
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('psbtBase64', 'base64psbt');
        expectGroupAwareEditLookup();
        expect(mockAdvancedTx.createRBFTransaction).toHaveBeenCalledWith(
          normalizedTxid,
          24,
          'wallet-1',
          'testnet4'
        );
      });

      it('carries isChange per output onto the wire so a change-aware client can tell recipient from change', async () => {
        // Regression for rbf-draft-recipient-picks-arbitrary-output-not-change-aware:
        // the route used to pass `result.outputs` straight through, but the
        // service stripped `isChange` before returning it. Assert here at the
        // wire boundary so a future strip-again regression fails the contract
        // that actually matters (what the client receives), not just the
        // service-level shape.
        const uppercaseTxid = 'C'.repeat(64);
        const normalizedTxid = uppercaseTxid.toLowerCase();
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'testnet4',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockResolvedValue({
          psbt: { toBase64: () => 'base64psbt' },
          fee: 6000,
          feeRate: 24,
          feeDelta: 1000,
          inputs: [],
          outputs: [
            { address: 'bc1qrecipient', value: 40000, isChange: false },
            { address: 'bc1qchange', value: 54000, isChange: true },
          ],
          inputPaths: [],
        });

        const response = await request(app)
          .post(`/bitcoin/transaction/${uppercaseTxid}/rbf`)
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(200);
        expect(response.body.outputs).toEqual([
          { address: 'bc1qrecipient', value: 40000, isChange: false },
          { address: 'bc1qchange', value: 54000, isChange: true },
        ]);
        expect(mockAdvancedTx.createRBFTransaction).toHaveBeenCalledWith(
          normalizedTxid,
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
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(new Error('rbf failed'));

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(500);
        expect(response.body.code).toBe('INTERNAL_ERROR');
      });

      it('should return 400 INVALID_INPUT when the original transaction is not replaceable', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(
          new InvalidInputError('Transaction is already confirmed', 'txid')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 INVALID_INPUT when the new fee rate is not higher than the current rate', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(
          new InvalidInputError(
            'New fee rate must be higher than current rate (10 sat/vB). Minimum: 11 sat/vB',
            'newFeeRate'
          )
        );

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 INVALID_INPUT when the replacement fee is not raised (BIP-125 rule 3)', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(
          new InvalidInputError(
            'New fee must exceed the original fee by at least 1 sat (BIP-125 rule 3); calculated fee delta was 0 sat(s).',
            'newFeeRate'
          )
        );

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 INVALID_INPUT when the replacement has no change output to absorb the fee bump', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(
          new InvalidInputError('No change output found to deduct additional fee from', 'txid')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 INVALID_INPUT when the fee bump would drop change below dust', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });
        mockAdvancedTx.createRBFTransaction.mockRejectedValue(
          new InvalidInputError(
            'Insufficient funds in change output to increase fee. Need 5000 sats more, but change would be dust.',
            'newFeeRate'
          )
        );

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 when wallet network is unsupported', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          name: 'Test Wallet',
          network: 'unsupported',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
        expect(mockAdvancedTx.createRBFTransaction).not.toHaveBeenCalled();
      });

      it('should return 404 when the transaction is not in the wallet', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({
          id: 'wallet-1',
          network: 'mainnet',
        });
        mockPrismaClient.transaction.findUnique.mockResolvedValue(null);

        const response = await request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' });

        expect(response.status).toBe(404);
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
        expectGroupAwareEditLookup();
        expect(mockAdvancedTx.createCPFPTransaction).toHaveBeenCalledWith(
          'parent123',
          0,
          30,
          'bc1qtest',
          'wallet-1',
          'testnet3'
        );
      });

      it('accepts an omitted parentVout and recipientAddress and forwards them as undefined', async () => {
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
            targetFeeRate: 30,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(200);
        expect(mockAdvancedTx.createCPFPTransaction).toHaveBeenCalledWith(
          'parent123',
          undefined,
          30,
          undefined,
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

      it('should return 400 when recipientAddress is malformed for the wallet network', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockUtils.validateAddress.mockReturnValueOnce({ valid: false, error: 'Invalid checksum' });

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'not-a-real-address',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(mockUtils.validateAddress).toHaveBeenCalledWith('not-a-real-address', 'mainnet');
        expect(mockAdvancedTx.createCPFPTransaction).not.toHaveBeenCalled();
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

      it('should return 404 when the parent UTXO is not found', async () => {
        const { NotFoundError } = await import('../../../../src/errors/ApiError');
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createCPFPTransaction.mockRejectedValue(new NotFoundError('UTXO not found'));

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(404);
      });

      it('should return 400 when the parent UTXO is already spent', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createCPFPTransaction.mockRejectedValue(
          new InvalidInputError('UTXO is already spent', 'parentVout')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 when the resulting child output would be dust', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createCPFPTransaction.mockRejectedValue(
          new InvalidInputError('Output would be dust (100 sats). Minimum is 546 sats.', 'parentVout')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'parent123',
            parentVout: 0,
            targetFeeRate: 30,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
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
        expectGroupAwareEditLookup();
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

      it('should return 400 when a recipient amount is fractional', async () => {
        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000.5 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(mockAdvancedTx.createBatchTransaction).not.toHaveBeenCalled();
      });

      it('should return 400 when a recipient address is malformed for the wallet network', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockUtils.validateAddress
          .mockReturnValueOnce({ valid: true })
          .mockReturnValueOnce({ valid: false, error: 'Invalid checksum' });

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [
              { address: 'bc1qtest1', amount: 100000 },
              { address: 'not-a-real-address', amount: 100000 },
            ],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
        expect(mockUtils.validateAddress).toHaveBeenNthCalledWith(2, 'not-a-real-address', 'mainnet');
        expect(mockAdvancedTx.createBatchTransaction).not.toHaveBeenCalled();
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

      it('should return 400 when there are no spendable UTXOs', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createBatchTransaction.mockRejectedValue(
          new InvalidInputError('No spendable UTXOs available', 'utxos')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });

      it('should return 400 when funds are insufficient to cover the batch', async () => {
        mockPrismaClient.wallet.findFirst.mockResolvedValue({ id: 'wallet-1', network: 'mainnet' });
        mockAdvancedTx.createBatchTransaction.mockRejectedValue(
          new InvalidInputError('Insufficient funds. Need 260000 sats, have 250000 sats', 'utxos')
        );

        const response = await request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('INVALID_INPUT');
      });
    });

    it.each([
      ['Ledger', 'ledger', 'ledger-nano-x'],
      ['Jade Plus', 'jade', 'jade-plus'],
      ['Trezor', 'trezor', 'trezor-safe-5'],
      ['descriptor-only recovery', 'watch_only', null],
    ])('blocks advanced PSBT construction for %s signer provenance', async (_name, type, modelSlug) => {
      const { ForbiddenError } = await import('../../../../src/errors');
      mockAssertWalletHardwareCapabilityById.mockRejectedValue(
        new ForbiddenError('blocked', undefined, { vendor: type, capability: 'sign' }),
      );
      mockPrismaClient.wallet.findFirst.mockResolvedValue({
        id: 'wallet-1',
        network: 'mainnet',
      });
      mockPrismaClient.wallet.findUnique.mockResolvedValue({
        id: 'wallet-1',
        devices: [{
          device: {
            type,
            model: modelSlug ? { slug: modelSlug, name: modelSlug } : null,
          },
        }],
      });
      mockPrismaClient.transaction.findUnique.mockResolvedValue({ id: 'tx-1' });

      const responses = await Promise.all([
        request(app)
          .post('/bitcoin/transaction/abc123/rbf')
          .send({ newFeeRate: 24, walletId: 'wallet-1' }),
        request(app)
          .post('/bitcoin/transaction/cpfp')
          .send({
            parentTxid: 'abc123',
            parentVout: 0,
            targetFeeRate: 20,
            recipientAddress: 'bc1qtest',
            walletId: 'wallet-1',
          }),
        request(app)
          .post('/bitcoin/transaction/batch')
          .send({
            recipients: [{ address: 'bc1qtest', amount: 250000 }],
            feeRate: 20,
            walletId: 'wallet-1',
          }),
      ]);

      expect(responses.map(({ status }) => status)).toEqual([403, 403, 403]);
      expect(mockAdvancedTx.createRBFTransaction).not.toHaveBeenCalled();
      expect(mockAdvancedTx.createCPFPTransaction).not.toHaveBeenCalled();
      expect(mockAdvancedTx.createBatchTransaction).not.toHaveBeenCalled();
    });
  });
};
