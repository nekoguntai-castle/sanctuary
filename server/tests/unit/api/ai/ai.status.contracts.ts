import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import { aiService } from '../../../../src/services/aiService';
import { featureFlagService } from '../../../../src/services/featureFlagService';

export function registerAiStatusContracts() {
  it('should return AI status when enabled and available', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
    });
    (aiService.isContainerAvailable as Mock).mockResolvedValue(true);

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.configured).toBe(true);
    expect(response.body.available).toBe(true);
    expect(response.body.model).toBe('llama2');
    expect(response.body.endpoint).toBe('http://localhost:11434');
    expect(response.body.containerAvailable).toBe(true);
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should return unavailable status when AI is disabled', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: false,
      configured: false,
    });

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.configured).toBe(false);
    expect(response.body.available).toBe(false);
    expect(response.body.message).toBe('AI is disabled');
  });

  it('should return unavailable status when the AI assistant feature flag is disabled', async () => {
    (featureFlagService.isEnabled as Mock).mockResolvedValue(false);
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
    });

    const response = await request(app)
      .get('/api/v1/ai/status')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(false);
    expect(response.body.configured).toBe(true);
    expect(response.body.available).toBe(false);
    expect(response.body.message).toBe('AI assistant feature is disabled');
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should expose enabled setup state when provider configuration is incomplete', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: false,
      endpoint: 'http://10.114.123.214:1234',
    });

    const response = await request(app)
      .get('/api/v1/ai/status')
      .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.configured).toBe(false);
    expect(response.body.available).toBe(false);
    expect(response.body.endpoint).toBe('http://10.114.123.214:1234');
    expect(response.body.message).toBe('AI provider is not configured');
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should return proxy availability details without model inference', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
    });
    (aiService.isContainerAvailable as Mock).mockResolvedValue(false);

    const response = await request(app)
  .get('/api/v1/ai/status')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.enabled).toBe(true);
    expect(response.body.configured).toBe(true);
    expect(response.body.available).toBe(false);
    expect(response.body.containerAvailable).toBe(false);
    expect(response.body.error).toBe('AI proxy container is not available');
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should run explicit admin connection tests through model health check', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
    });
    (aiService.checkHealth as Mock).mockResolvedValue({
      available: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
      containerAvailable: true,
    });

    const response = await request(app)
      .post('/api/v1/ai/test-connection')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: true,
      configured: true,
      available: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
      containerAvailable: true,
    });
    expect(aiService.checkHealth).toHaveBeenCalledTimes(1);
  });

  it('should skip explicit connection health checks when the AI assistant feature is disabled', async () => {
    (featureFlagService.isEnabled as Mock).mockResolvedValue(false);
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: true,
      model: 'llama2',
      endpoint: 'http://localhost:11434',
    });

    const response = await request(app)
      .post('/api/v1/ai/test-connection')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: false,
      configured: true,
      available: false,
      message: 'AI assistant feature is disabled',
    });
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should not run explicit connection tests when provider setup is incomplete', async () => {
    (aiService.getConfigStatus as Mock).mockResolvedValue({
      enabled: true,
      configured: false,
      endpoint: 'http://10.114.123.214:1234',
    });

    const response = await request(app)
      .post('/api/v1/ai/test-connection')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({});

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      enabled: true,
      configured: false,
      available: false,
      endpoint: 'http://10.114.123.214:1234',
      message: 'AI provider is not configured',
    });
    expect(aiService.checkHealth).not.toHaveBeenCalled();
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.getConfigStatus as Mock).mockRejectedValue(new Error('Unexpected error'));

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
