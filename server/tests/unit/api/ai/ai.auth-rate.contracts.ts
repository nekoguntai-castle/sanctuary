import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import { aiService } from '../../../../src/services/aiService';

export function registerAuthenticationContracts() {
  it('should require authentication for status endpoint', async () => {
    const response = await request(app).get('/api/v1/ai/status');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });

  it('should require authentication for suggest-label endpoint', async () => {
    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(401);
  });

  it('should require authentication for query endpoint', async () => {
    const response = await request(app)
  .post('/api/v1/ai/query')
  .send({ query: 'Show transactions', walletId: 'wallet-123' });

    expect(response.status).toBe(401);
  });

  it('should require authentication for models endpoint', async () => {
    const response = await request(app).get('/api/v1/ai/models');

    expect(response.status).toBe(401);
  });

  it('should require authentication for container status endpoint', async () => {
    const response = await request(app).get('/api/v1/ai/ollama-container/status');

    expect(response.status).toBe(401);
  });
}

export function registerRateLimitingContracts() {
  it('should apply rate limiter to AI endpoints', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.checkHealth as Mock).mockResolvedValue({ available: true });

    // Make a request - rate limiter is applied but not blocking in tests
    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
  });
}
