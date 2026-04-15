import { describe, expect, it } from 'vitest';

import {
  mockEvaluatePolicies,
  mockGetWalletPolicyEvents,
  walletPoliciesRequest,
} from './walletPoliciesTestHarness';

export function registerWalletPolicyEventsEvaluationTests(): void {
  describe('GET /:walletId/policies/events', () => {
    it('returns policy events with default pagination', async () => {
      const eventsResult = { events: [{ id: 'evt-1' }], total: 1 };
      mockGetWalletPolicyEvents.mockResolvedValue(eventsResult);

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies/events');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(eventsResult);
      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1', {
        policyId: undefined,
        eventType: undefined,
        from: undefined,
        to: undefined,
        limit: 50,
        offset: 0,
      });
    });

    it('passes query filters to findPolicyEvents', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      const response = await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({
          policyId: 'pol-1',
          eventType: 'trigger',
          from: '2025-01-01T00:00:00Z',
          to: '2025-12-31T23:59:59Z',
          limit: '10',
          offset: '5',
        });

      expect(response.status).toBe(200);
      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1', {
        policyId: 'pol-1',
        eventType: 'trigger',
        from: new Date('2025-01-01T00:00:00Z'),
        to: new Date('2025-12-31T23:59:59Z'),
        limit: 10,
        offset: 5,
      });
    });

    it('clamps limit to MAX_PAGE_LIMIT (200)', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: '500' });

      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 200 })
      );
    });

    it('clamps limit minimum to 1', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: '0' });

      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 1 })
      );
    });

    it('falls back to default limit when NaN', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ limit: 'abc' });

      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ limit: 50 })
      );
    });

    it('falls back to default offset when NaN', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ offset: 'abc' });

      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ offset: 0 })
      );
    });

    it('clamps negative offset to 0', async () => {
      mockGetWalletPolicyEvents.mockResolvedValue({ events: [], total: 0 });

      await walletPoliciesRequest()
        .get('/api/v1/wallets/wallet-1/policies/events')
        .query({ offset: '-5' });

      expect(mockGetWalletPolicyEvents).toHaveBeenCalledWith('wallet-1',
        expect.objectContaining({ offset: 0 })
      );
    });

    it('returns 500 when findPolicyEvents throws', async () => {
      mockGetWalletPolicyEvents.mockRejectedValue(new Error('db failure'));

      const response = await walletPoliciesRequest().get('/api/v1/wallets/wallet-1/policies/events');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /:walletId/policies/evaluate', () => {
    it('evaluates policies for a valid request', async () => {
      const evalResult = { allowed: true, triggered: [] };
      mockEvaluatePolicies.mockResolvedValue(evalResult);

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(evalResult);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        userId: 'user-1',
        recipient: 'tb1qaddr',
        amount: BigInt(50000),
        outputs: undefined,
        preview: true,
      });
    });

    it('accepts string amount', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '100000' });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(100000) })
      );
    });

    it('passes outputs to evaluator', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });
      const outputs = [{ address: 'tb1qout', amount: 50000 }];

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000, outputs });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ outputs })
      );
    });

    it('returns 400 when recipient is missing', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ amount: 50000 });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is missing', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is undefined', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: undefined });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('recipient and amount are required');
    });

    it('returns 400 when amount is not a valid integer string', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 'abc' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('amount must be a valid non-negative integer');
    });

    it('returns 400 when amount is a negative string', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '-100' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('amount must be a valid non-negative integer');
    });

    it('returns 400 when amount is a boolean', async () => {
      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: true });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('amount must be a valid non-negative integer');
    });

    it('accepts amount of 0 (number)', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 0 });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(0) })
      );
    });

    it('accepts amount of "0" (string)', async () => {
      mockEvaluatePolicies.mockResolvedValue({ allowed: true });

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: '0' });

      expect(response.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(
        expect.objectContaining({ amount: BigInt(0) })
      );
    });

    it('returns 500 when evaluatePolicies throws', async () => {
      mockEvaluatePolicies.mockRejectedValue(new Error('eval failure'));

      const response = await walletPoliciesRequest()
        .post('/api/v1/wallets/wallet-1/policies/evaluate')
        .send({ recipient: 'tb1qaddr', amount: 50000 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });
}
