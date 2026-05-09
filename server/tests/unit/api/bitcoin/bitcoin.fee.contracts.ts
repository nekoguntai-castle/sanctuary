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

export const registerBitcoinFeeRouteTests = () => {
  describe('Fee Routes', () => {
    describe('GET /bitcoin/fees', () => {
      it('should return mempool.space fees when configured', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: 'https://mempool.space',
        });
        mockMempool.getRecommendedFees.mockResolvedValue({
          fastestFee: 50,
          halfHourFee: 30,
          hourFee: 20,
          economyFee: 10,
          minimumFee: 5,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(mockMempool.getRecommendedFees).toHaveBeenCalledWith('mainnet');
        expect(response.body).toMatchObject({
          fastest: 50,
          halfHour: 30,
          hour: 20,
          economy: 10,
          minimum: 5,
          source: 'mempool',
        });
      });

      it('should fallback to electrum fees when mempool fails', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: 'https://mempool.space',
        });
        mockMempool.getRecommendedFees.mockRejectedValue(new Error('API error'));
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 8,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('source', 'electrum');
        expect(mockBlockchain.getFeeEstimates).toHaveBeenCalledWith('mainnet');
      });

      it('should use electrum when no feeEstimatorUrl configured', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: '',
        });
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 8,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('source', 'electrum');
        expect(mockBlockchain.getFeeEstimates).toHaveBeenCalledWith('mainnet');
      });

      it('passes query network to the configured network fee estimator', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: 'https://mempool.space',
          testnet4FeeEstimatorUrl: 'https://mempool.space/testnet4',
        });
        mockMempool.getRecommendedFees.mockResolvedValue({
          fastestFee: 3,
          halfHourFee: 2,
          hourFee: 1,
          economyFee: 1,
          minimumFee: 1,
        });

        const response = await request(app).get('/bitcoin/fees?network=testnet4');

        expect(response.status).toBe(200);
        expect(mockMempool.getRecommendedFees).toHaveBeenCalledWith('testnet4');
      });

      it('rejects invalid fee networks', async () => {
        const response = await request(app).get('/bitcoin/fees?network=dogecoin');

        expect(response.status).toBe(400);
        expect(mockMempool.getRecommendedFees).not.toHaveBeenCalled();
        expect(mockBlockchain.getFeeEstimates).not.toHaveBeenCalled();
      });

      it('should default minimum fee to 1 when electrum economy fee is missing', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({
          feeEstimatorUrl: '',
        });
        mockBlockchain.getFeeEstimates.mockResolvedValue({
          fastest: 40,
          halfHour: 25,
          hour: 15,
          economy: 0,
        });

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(200);
        expect(response.body.minimum).toBe(1);
        expect(response.body.source).toBe('electrum');
      });

      it('should return 500 on complete failure', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue({ feeEstimatorUrl: '' });
        mockBlockchain.getFeeEstimates.mockRejectedValue(new Error('Failed'));

        const response = await request(app).get('/bitcoin/fees');

        expect(response.status).toBe(500);
      });
    });

    describe('GET /bitcoin/fees/advanced', () => {
      it('should return advanced fee estimates', async () => {
        const advancedFees = {
          tiers: [
            { feeRate: 50, priority: 'high', estimatedMinutes: 10 },
            { feeRate: 30, priority: 'medium', estimatedMinutes: 30 },
          ],
        };
        mockAdvancedTx.getAdvancedFeeEstimates.mockResolvedValue(advancedFees);

        const response = await request(app).get('/bitcoin/fees/advanced');

        expect(response.status).toBe(200);
        expect(response.body).toEqual(advancedFees);
        expect(mockAdvancedTx.getAdvancedFeeEstimates).toHaveBeenCalledWith('mainnet');
      });

      it('passes query network to advanced fee estimates', async () => {
        mockAdvancedTx.getAdvancedFeeEstimates.mockResolvedValue({});

        const response = await request(app).get('/bitcoin/fees/advanced?network=signet');

        expect(response.status).toBe(200);
        expect(mockAdvancedTx.getAdvancedFeeEstimates).toHaveBeenCalledWith('signet');
      });

      it('should return 500 on error', async () => {
        mockAdvancedTx.getAdvancedFeeEstimates.mockRejectedValue(new Error('Failed'));

        const response = await request(app).get('/bitcoin/fees/advanced');

        expect(response.status).toBe(500);
      });
    });

    describe('POST /bitcoin/utils/estimate-fee', () => {
      it('should estimate fee for given parameters', async () => {
        mockUtils.estimateTransactionSize.mockReturnValue(250);
        mockUtils.calculateFee.mockReturnValue(5000);

        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          size: 250,
          fee: 5000,
          feeRate: 20,
        });
      });

      it('should accept custom scriptType', async () => {
        mockUtils.estimateTransactionSize.mockReturnValue(300);
        mockUtils.calculateFee.mockReturnValue(6000);

        await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20, scriptType: 'p2sh_segwit' });

        expect(mockUtils.estimateTransactionSize).toHaveBeenCalledWith(2, 2, 'p2sh_segwit');
      });

      it('should return 400 when inputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(400);
      });

      it('should return 400 when outputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, feeRate: 20 });

        expect(response.status).toBe(400);
      });

      it('should return 400 when feeRate is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(400);
      });

      it('should return 500 when transaction size estimation throws', async () => {
        mockUtils.estimateTransactionSize.mockImplementation(() => {
          throw new Error('size calc failed');
        });

        const response = await request(app)
          .post('/bitcoin/utils/estimate-fee')
          .send({ inputCount: 2, outputCount: 2, feeRate: 20 });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });

    describe('POST /bitcoin/utils/estimate-optimal-fee', () => {
      it('should estimate optimal fee', async () => {
        const result = { feeRate: 25, fee: 6250, estimatedMinutes: 20 };
        mockAdvancedTx.estimateOptimalFee.mockResolvedValue(result);

        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(200);
        expect(response.body).toEqual(result);
      });

      it('should accept priority parameter', async () => {
        mockAdvancedTx.estimateOptimalFee.mockResolvedValue({});

        await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2, priority: 'high' });

        expect(mockAdvancedTx.estimateOptimalFee).toHaveBeenCalledWith(2, 2, 'high', 'native_segwit', 'mainnet');
      });

      it('passes request network to optimal fee estimation', async () => {
        mockAdvancedTx.estimateOptimalFee.mockResolvedValue({});

        await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2, network: 'testnet3' });

        expect(mockAdvancedTx.estimateOptimalFee).toHaveBeenCalledWith(2, 2, 'medium', 'native_segwit', 'testnet3');
      });

      it('should return 400 when inputCount is missing', async () => {
        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ outputCount: 2 });

        expect(response.status).toBe(400);
      });

      it('should return 500 when optimal fee estimation fails', async () => {
        mockAdvancedTx.estimateOptimalFee.mockRejectedValue(new Error('estimate failed'));

        const response = await request(app)
          .post('/bitcoin/utils/estimate-optimal-fee')
          .send({ inputCount: 2, outputCount: 2 });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          code: 'INTERNAL_ERROR',
        });
      });
    });
  });
};
