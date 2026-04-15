import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

type PayjoinSecurityContractsContext = {
  getApp: () => Express;
  mockProcessPayjoinRequest: ReturnType<typeof import('vitest').vi.fn>;
  testAddressId: string;
  testWalletId: string;
  validPsbtBase64: string;
  proposalPsbtBase64: string;
};

export function registerPayjoinSecurityContracts({
  getApp,
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
}
