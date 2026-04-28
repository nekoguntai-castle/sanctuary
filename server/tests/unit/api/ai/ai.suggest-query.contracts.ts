import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import { aiService } from '../../../../src/services/aiService';

export function registerSuggestLabelContracts() {
  it('should return label suggestion when AI is available', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockResolvedValue('Exchange deposit');

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer test-token')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(200);
    expect(response.body.suggestion).toBe('Exchange deposit');
    expect(aiService.suggestTransactionLabel).toHaveBeenCalledWith('tx-123', 'test-token');
  });

  it('should forward cookie access tokens for browser label suggestions', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockResolvedValue('Exchange deposit');

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Cookie', 'sanctuary_access=cookie-token')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(200);
    expect(aiService.suggestTransactionLabel).toHaveBeenCalledWith('tx-123', 'cookie-token');
  });

  it('should return 400 when transactionId is missing', async () => {
    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer test-token')
  .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.message).toBe('transactionId is required');
  });

  it('should return 503 when AI is not enabled', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(false);

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer test-token')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Service Unavailable');
    expect(response.body.message).toBe('AI is not enabled or configured');
  });

  it('should return 503 when suggestion is null', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockResolvedValue(null);

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer test-token')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Service Unavailable');
    expect(response.body.message).toBe('AI endpoint is not available or returned no suggestion');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockRejectedValue(new Error('AI error'));

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer test-token')
  .send({ transactionId: 'tx-123' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('should forward empty auth token when bearer prefix has no token', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockResolvedValue('General');

    const response = await request(app)
  .post('/api/v1/ai/suggest-label')
  .set('Authorization', 'Bearer ')
  .send({ transactionId: 'tx-empty-token' });

    expect(response.status).toBe(200);
    expect(aiService.suggestTransactionLabel).toHaveBeenCalledWith('tx-empty-token', '');
  });

  it('should forward empty auth token when authentication is not a bearer token', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.suggestTransactionLabel as Mock).mockResolvedValue('General');

    const response = await request(app)
      .post('/api/v1/ai/suggest-label')
      .set('Authorization', 'Token test-token')
      .send({ transactionId: 'tx-non-bearer-token' });

    expect(response.status).toBe(200);
    expect(aiService.suggestTransactionLabel).toHaveBeenCalledWith(
      'tx-non-bearer-token',
      ''
    );
  });
}

export function registerNaturalQueryContracts() {
  it('should return structured query result', async () => {
    const expectedResult = {
  type: 'transactions',
  filter: { type: 'receive' },
  sort: { field: 'amount', order: 'desc' },
  limit: 10,
    };

    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.executeNaturalQuery as Mock).mockResolvedValue(expectedResult);

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ query: 'Show my largest receives', walletId: 'wallet-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResult);
    expect(aiService.executeNaturalQuery).toHaveBeenCalledWith(
  'Show my largest receives',
  'wallet-123',
  'test-token'
    );
  });

  it('should forward cookie access tokens for browser natural queries', async () => {
    const expectedResult = {
  type: 'transactions',
  filter: { dateFrom: '2020-02-01', dateTo: '2020-06-30' },
    };

    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.executeNaturalQuery as Mock).mockResolvedValue(expectedResult);

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Cookie', 'sanctuary_access=cookie-token')
  .send({ query: 'show me transactions between feb 2020 and june 2020', walletId: 'wallet-123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expectedResult);
    expect(aiService.executeNaturalQuery).toHaveBeenCalledWith(
  'show me transactions between feb 2020 and june 2020',
  'wallet-123',
  'cookie-token'
    );
  });

  it('should return 400 when query is missing', async () => {
    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ walletId: 'wallet-123' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.message).toBe('Query and walletId are required');
  });

  it('should return 400 when walletId is missing', async () => {
    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ query: 'Show transactions' });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.message).toBe('Query and walletId are required');
  });

  it('should return 503 when AI is not enabled', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(false);

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ query: 'Show transactions', walletId: 'wallet-123' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Service Unavailable');
  });

  it('should return 503 when query result is null', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.executeNaturalQuery as Mock).mockResolvedValue(null);

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ query: 'Show transactions', walletId: 'wallet-123' });

    expect(response.status).toBe(503);
    expect(response.body.error).toBe('Service Unavailable');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.executeNaturalQuery as Mock).mockRejectedValue(new Error('Query error'));

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer test-token')
  .send({ query: 'Show transactions', walletId: 'wallet-123' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('should forward empty auth token when bearer prefix has no token', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.executeNaturalQuery as Mock).mockResolvedValue({ type: 'summary' });

    const response = await request(app)
  .post('/api/v1/ai/query')
  .set('Authorization', 'Bearer ')
  .send({ query: 'summarize', walletId: 'wallet-123' });

    expect(response.status).toBe(200);
    expect(aiService.executeNaturalQuery).toHaveBeenCalledWith('summarize', 'wallet-123', '');
  });
}
