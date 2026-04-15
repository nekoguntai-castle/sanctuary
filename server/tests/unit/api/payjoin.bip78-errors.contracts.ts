import { describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';

type PayjoinBip78ErrorContractsContext = {
  getApp: () => Express;
  mockProcessPayjoinRequest: ReturnType<typeof import('vitest').vi.fn>;
  testAddressId: string;
  validPsbtBase64: string;
};

export function registerPayjoinBip78ErrorContracts({
  getApp,
  mockProcessPayjoinRequest,
  testAddressId,
  validPsbtBase64,
}: PayjoinBip78ErrorContractsContext) {
  describe('BIP78 Error Codes', () => {
    it('should return version-unsupported for wrong version', async () => {
      const res = await request(getApp())
        .post(`/api/v1/payjoin/${testAddressId}?v=0`)
        .set('Content-Type', 'text/plain')
        .send(validPsbtBase64);

      expect(res.text).toBe('version-unsupported');
    });

    it('should return unavailable when service reports it', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: false,
        error: 'unavailable',
        errorMessage: 'Address not found',
      });

      const res = await request(getApp())
        .post(`/api/v1/payjoin/${testAddressId}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(validPsbtBase64);

      expect(res.text).toBe('unavailable');
    });

    it('should return not-enough-money when no UTXOs', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: false,
        error: 'not-enough-money',
        errorMessage: 'No suitable UTXOs',
      });

      const res = await request(getApp())
        .post(`/api/v1/payjoin/${testAddressId}?v=1`)
        .set('Content-Type', 'text/plain')
        .send(validPsbtBase64);

      expect(res.text).toBe('not-enough-money');
    });

    it('should return original-psbt-rejected for invalid PSBT', async () => {
      mockProcessPayjoinRequest.mockResolvedValue({
        success: false,
        error: 'original-psbt-rejected',
        errorMessage: 'PSBT has no inputs',
      });

      const res = await request(getApp())
        .post(`/api/v1/payjoin/${testAddressId}?v=1`)
        .set('Content-Type', 'text/plain')
        .send('invalid-psbt');

      expect(res.text).toBe('original-psbt-rejected');
    });
  });
}
