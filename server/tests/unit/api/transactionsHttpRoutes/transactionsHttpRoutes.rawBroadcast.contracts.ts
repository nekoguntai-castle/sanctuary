import { expect, it } from 'vitest';
import request from 'supertest';
import {
  app,
  mockBroadcastAndSave,
  walletId,
} from './transactionsHttpRoutesTestHarness';

export function registerTransactionHttpRawBroadcastTests(): void {
  it('rejects raw broadcast without an authenticated signing-intent handle', async () => {
    const response = await request(app)
      .post(`/api/v1/wallets/${walletId}/transactions/broadcast`)
      .send({ rawTxHex: '00' });

    expect(response.status).toBe(400);
    expect(response.body.details).toMatchObject({
      issues: [expect.objectContaining({ path: 'intentId' })],
    });
    expect(mockBroadcastAndSave).not.toHaveBeenCalled();
  });
}
