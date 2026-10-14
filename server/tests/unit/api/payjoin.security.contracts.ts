import { describe, expect, it, type MockInstance } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

type PayjoinSecurityContractsContext = {
  getApp: () => Express;
  submitPayjoinAttempt: () => request.Test;
  mockAttemptPayjoinSend: ReturnType<typeof import('vitest').vi.fn>;
  mockCreateSigningIntent: MockInstance;
  mockBuildIntentPolicyInput: MockInstance;
  mockEvaluatePolicies: MockInstance;
  mockProcessPayjoinRequest: ReturnType<typeof import('vitest').vi.fn>;
  testAddressId: string;
  testWalletId: string;
  validPsbtBase64: string;
  proposalPsbtBase64: string;
};

export function registerPayjoinSecurityContracts({
  getApp,
  submitPayjoinAttempt,
  mockAttemptPayjoinSend,
  mockCreateSigningIntent,
  mockBuildIntentPolicyInput,
  mockEvaluatePolicies,
  mockProcessPayjoinRequest,
  testAddressId,
  testWalletId,
  validPsbtBase64,
  proposalPsbtBase64,
}: PayjoinSecurityContractsContext) {
  describe('Security and Access Control', () => {
    it('should allow unauthenticated access to BIP78 receiver endpoint', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: true,
        proposalPsbt: proposalPsbtBase64,
      });

      // No Authorization header
      const res = await request(getApp())
        .post(`/api/v1/payjoin/${testAddressId}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(validPsbtBase64);

      expect(res.status).toBe(200);
    });

    it('should require authentication for eligibility check', async () => {
      const res = await request(getApp()).get(`/api/v1/payjoin/eligibility/${testWalletId}`);

      expect(res.status).toBe(401);
    });

    it('should require authentication for URI generation', async () => {
      const res = await request(getApp()).get(`/api/v1/payjoin/address/${testAddressId}/uri`);

      expect(res.status).toBe(401);
    });

    it('should require authentication for URI parsing', async () => {
      const res = await request(getApp()).post('/api/v1/payjoin/parse-uri').send({ uri: 'bitcoin:...' });

      expect(res.status).toBe(401);
    });

    it('should require authentication for Payjoin attempt', async () => {
      const res = await request(getApp()).post('/api/v1/payjoin/attempt').send({
        psbt: validPsbtBase64,
        payjoinUrl: 'https://example.com/pj',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('vault approval policy on payjoin attempts', () => {
    const originalSpend = {
      walletId: testWalletId, userId: 'user-123', recipient: 'bc1qrecipient', amount: BigInt(9_400),
      outputs: [{ address: 'bc1qrecipient', amount: 9_400 }],
    };

    it('refuses an approval-required spend before the original PSBT reaches the receiver', async () => {
      mockBuildIntentPolicyInput.mockResolvedValueOnce(originalSpend);
      mockEvaluatePolicies.mockResolvedValueOnce({
        allowed: true,
        triggered: [{ policyId: 'pa', policyName: 'Approve', type: 'approval_required', action: 'approval_required', reason: 'always' }],
      });

      const res = await submitPayjoinAttempt();

      expect(res.status).toBe(403);
      expect(res.body.details).toMatchObject({ reason: 'approval_required' });
      expect(mockEvaluatePolicies).toHaveBeenCalledWith({ ...originalSpend, preview: true });
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it('refuses a policy-blocked spend before the original PSBT reaches the receiver', async () => {
      mockBuildIntentPolicyInput.mockResolvedValueOnce(originalSpend);
      mockEvaluatePolicies.mockResolvedValueOnce({
        allowed: false,
        triggered: [{ policyId: 'pl', policyName: 'Limit', type: 'spending_limit', action: 'blocked', reason: 'Over limit' }],
      });

      const res = await submitPayjoinAttempt();

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Transaction blocked by vault policy');
      expect(mockAttemptPayjoinSend).not.toHaveBeenCalled();
      expect(mockCreateSigningIntent).not.toHaveBeenCalled();
    });

    it('evaluates the original intent only as a preview when no approval is required', async () => {
      mockBuildIntentPolicyInput.mockResolvedValueOnce(originalSpend);
      mockAttemptPayjoinSend.mockResolvedValueOnce({ success: false, error: 'receiver unavailable' });

      const res = await submitPayjoinAttempt();

      expect(res.status).toBe(200);
      expect(mockEvaluatePolicies).toHaveBeenCalledOnce();
      expect(mockEvaluatePolicies).toHaveBeenCalledWith(expect.objectContaining({ preview: true }));
      expect(mockAttemptPayjoinSend).toHaveBeenCalledOnce();
    });
  });
}
