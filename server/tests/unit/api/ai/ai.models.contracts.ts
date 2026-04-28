import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import { aiService } from '../../../../src/services/aiService';

export function registerDetectOllamaContracts() {
  it('should return detection results when Ollama is found', async () => {
    (aiService.detectOllama as Mock).mockResolvedValue({
  found: true,
  endpoint: 'http://localhost:11434',
  models: ['llama2', 'codellama'],
    });

    const response = await request(app)
  .post('/api/v1/ai/detect-ollama')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(true);
    expect(response.body.endpoint).toBe('http://localhost:11434');
    expect(response.body.models).toContain('llama2');
  });

  it('should return not found when Ollama is unavailable', async () => {
    (aiService.detectOllama as Mock).mockResolvedValue({
  found: false,
  message: 'No Ollama instance found',
    });

    const response = await request(app)
  .post('/api/v1/ai/detect-ollama')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.found).toBe(false);
    expect(response.body.message).toBeDefined();
  });

  it('should return 500 on error', async () => {
    (aiService.detectOllama as Mock).mockRejectedValue(new Error('Detection error'));

    const response = await request(app)
  .post('/api/v1/ai/detect-ollama')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('should detect a provider at a typed endpoint', async () => {
    (aiService.detectProviderEndpoint as Mock).mockResolvedValue({
      found: true,
      providerType: 'openai-compatible',
      endpoint: 'http://10.114.123.214:1234',
      models: [{ name: 'qwen/qwen3.6-35b-a3b', size: 0, modifiedAt: '' }],
    });

    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'http://10.114.123.214:1234',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(200);
    expect(aiService.detectProviderEndpoint).toHaveBeenCalledWith({
      endpoint: 'http://10.114.123.214:1234',
      preferredProviderType: 'openai-compatible',
    });
    expect(response.body.models[0].name).toBe('qwen/qwen3.6-35b-a3b');
  });

  it('should return 502 when typed provider detection cannot connect', async () => {
    (aiService.detectProviderEndpoint as Mock).mockResolvedValue({
      found: false,
      message: 'No supported model provider responded at this endpoint.',
    });

    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'http://10.114.123.214:1234',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(502);
    expect(response.body.message).toBe(
      'No supported model provider responded at this endpoint.',
    );
  });

  it('should return 400 when typed provider detection is blocked', async () => {
    (aiService.detectProviderEndpoint as Mock).mockResolvedValue({
      found: false,
      blockedReason: 'host_not_allowed',
      message: 'AI endpoint is not allowed: host_not_allowed',
    });

    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'http://203.0.113.10:1234',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      'AI endpoint is not allowed: host_not_allowed',
    );
  });

  it('should return fallback provider detection messages when proxy omits a message', async () => {
    (aiService.detectProviderEndpoint as Mock).mockResolvedValue({
      found: false,
    });

    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'http://10.114.123.214:1234',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('Provider detection failed');
  });

  it('should reject malformed provider detection endpoints before proxy detection', async () => {
    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'not-a-url',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Valid provider endpoint is required');
    expect(aiService.detectProviderEndpoint).not.toHaveBeenCalled();
  });

  it('should reject non-HTTP provider detection endpoints before proxy detection', async () => {
    const response = await request(app)
      .post('/api/v1/ai/detect-provider')
      .set('Authorization', 'Bearer test-token')
      .set('x-test-admin', 'true')
      .send({
        endpoint: 'ftp://10.114.123.214:1234',
        preferredProviderType: 'openai-compatible',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Valid provider endpoint is required');
    expect(aiService.detectProviderEndpoint).not.toHaveBeenCalled();
  });
}

export function registerListModelsContracts() {
  it('should return list of available models', async () => {
    (aiService.listModels as Mock).mockResolvedValue({
  models: [
    { name: 'llama2', size: 3826793472, modifiedAt: '2024-01-15T10:00:00Z' },
    { name: 'codellama', size: 3826793472, modifiedAt: '2024-01-14T10:00:00Z' },
  ],
    });

    const response = await request(app)
  .get('/api/v1/ai/models')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(200);
    expect(response.body.models).toHaveLength(2);
    expect(response.body.models[0].name).toBe('llama2');
  });

  it('should return 502 when models endpoint returns error', async () => {
    (aiService.listModels as Mock).mockResolvedValue({
  models: [],
  error: 'Failed to connect to Ollama',
    });

    const response = await request(app)
  .get('/api/v1/ai/models')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('Bad Gateway');
    expect(response.body.message).toBe('Failed to connect to Ollama');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.listModels as Mock).mockRejectedValue(new Error('List error'));

    const response = await request(app)
  .get('/api/v1/ai/models')
  .set('Authorization', 'Bearer test-token');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });
}

export function registerPullModelContracts() {
  it('should successfully pull a model (admin only)', async () => {
    (aiService.pullModel as Mock).mockResolvedValue({
  success: true,
  model: 'llama2',
  status: 'completed',
    });

    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.model).toBe('llama2');
  });

  it('should return 403 for non-admin users', async () => {
    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .send({ model: 'llama2' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
  });

  it('should return 400 when model name is missing', async () => {
    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.message).toBe('Model name is required');
  });

  it('should return 502 when pull fails', async () => {
    (aiService.pullModel as Mock).mockResolvedValue({
  success: false,
  error: 'Model not found in registry',
    });

    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'nonexistent-model' });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('Bad Gateway');
    expect(response.body.message).toBe('Model not found in registry');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.pullModel as Mock).mockRejectedValue(new Error('Pull error'));

    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('should use default pull failure message when service omits error', async () => {
    (aiService.pullModel as Mock).mockResolvedValue({
  success: false,
    });

    const response = await request(app)
  .post('/api/v1/ai/pull-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('Pull failed');
  });
}

export function registerDeleteModelContracts() {
  it('should successfully delete a model (admin only)', async () => {
    (aiService.deleteModel as Mock).mockResolvedValue({
  success: true,
    });

    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });

  it('should return 403 for non-admin users', async () => {
    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .send({ model: 'llama2' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('Forbidden');
  });

  it('should return 400 when model name is missing', async () => {
    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({});

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_INPUT');
    expect(response.body.message).toBe('Model name is required');
  });

  it('should return 502 when delete fails', async () => {
    (aiService.deleteModel as Mock).mockResolvedValue({
  success: false,
  error: 'Model is in use',
    });

    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe('Bad Gateway');
  });

  it('should return 500 on unexpected error', async () => {
    (aiService.deleteModel as Mock).mockRejectedValue(new Error('Delete error'));

    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(response.body.message).toBe('An unexpected error occurred');
  });

  it('should use default delete failure message when service omits error', async () => {
    (aiService.deleteModel as Mock).mockResolvedValue({
  success: false,
    });

    const response = await request(app)
  .delete('/api/v1/ai/delete-model')
  .set('Authorization', 'Bearer test-token')
  .set('x-test-admin', 'true')
  .send({ model: 'llama2' });

    expect(response.status).toBe(502);
    expect(response.body.message).toBe('Delete failed');
  });
}
