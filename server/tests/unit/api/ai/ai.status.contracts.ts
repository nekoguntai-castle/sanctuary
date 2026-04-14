import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import { aiService } from '../../../../src/services/aiService';

export function registerAiStatusContracts() {
  it('should return AI status when enabled and available', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.checkHealth as Mock).mockResolvedValue({
  available: true,
  model: 'llama2',
  endpoint: 'http://localhost:11434',
  containerAvailable: true,
    });

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(true);
    expect(response.body.model).toBe('llama2');
    expect(response.body.endpoint).toBe('http://localhost:11434');
    expect(response.body.containerAvailable).toBe(true);
  });

  it('should return unavailable status when AI is disabled', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(false);

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
    expect(response.body.message).toBe('AI is disabled or not configured');
  });

  it('should return error details when health check fails', async () => {
    (aiService.isEnabled as Mock).mockResolvedValue(true);
    (aiService.checkHealth as Mock).mockResolvedValue({
  available: false,
  model: 'llama2',
  endpoint: 'http://localhost:11434',
  containerAvailable: false,
  error: 'AI container is not available',
    });

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.available).toBe(false);
    expect(response.body.error).toBe('AI container is not available');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.isEnabled as Mock).mockRejectedValue(new Error('Unexpected error'));

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('should require authentication', async () => {
    const response = await request(app).get('/api/v1/ai/status');

    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized');
  });
}
