import { expect, it, type Mock } from 'vitest';

import { app, request } from './aiTestHarness';
import * as docker from '../../../../src/utils/docker';

export function registerOllamaContainerStatusContracts() {
    it('should return container status when docker proxy is available', async () => {
  (docker.isDockerProxyAvailable as Mock).mockResolvedValue(true);
  (docker.getOllamaStatus as Mock).mockResolvedValue({
    exists: true,
    running: true,
    status: 'running',
    containerId: 'abc123',
  });

  const response = await request(app)
    .get('/api/v1/ai/ollama-container/status')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(200);
  expect(response.body.available).toBe(true);
  expect(response.body.exists).toBe(true);
  expect(response.body.running).toBe(true);
    });

    it('should return unavailable when docker proxy is not available', async () => {
  (docker.isDockerProxyAvailable as Mock).mockResolvedValue(false);

  const response = await request(app)
    .get('/api/v1/ai/ollama-container/status')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(200);
  expect(response.body.available).toBe(false);
  expect(response.body.message).toBe('Docker management not available');
    });

    it('should return 500 on error', async () => {
  (docker.isDockerProxyAvailable as Mock).mockRejectedValue(new Error('Docker error'));

  const response = await request(app)
    .get('/api/v1/ai/ollama-container/status')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('INTERNAL_ERROR');
    });
}

export function registerOllamaContainerStartContracts() {
    it('should start the container successfully', async () => {
  (docker.startOllama as Mock).mockResolvedValue({
    success: true,
    message: 'Ollama started successfully',
  });

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/start')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
    });

    it('should return 400 when start fails', async () => {
  (docker.startOllama as Mock).mockResolvedValue({
    success: false,
    message: 'Container not found',
  });

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/start')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(400);
  expect(response.body.error).toBe('Failed to start');
    });

    it('should return 500 on error', async () => {
  (docker.startOllama as Mock).mockRejectedValue(new Error('Start error'));

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/start')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('INTERNAL_ERROR');
    });
}

export function registerOllamaContainerStopContracts() {
    it('should stop the container successfully', async () => {
  (docker.stopOllama as Mock).mockResolvedValue({
    success: true,
    message: 'Ollama stopped successfully',
  });

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/stop')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(200);
  expect(response.body.success).toBe(true);
    });

    it('should return 400 when stop fails', async () => {
  (docker.stopOllama as Mock).mockResolvedValue({
    success: false,
    message: 'Container is not running',
  });

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/stop')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(400);
  expect(response.body.error).toBe('Failed to stop');
    });

    it('should return 500 on error', async () => {
  (docker.stopOllama as Mock).mockRejectedValue(new Error('Stop error'));

  const response = await request(app)
    .post('/api/v1/ai/ollama-container/stop')
    .set('Authorization', 'Bearer test-token');

  expect(response.status).toBe(500);
  expect(response.body.code).toBe('INTERNAL_ERROR');
    });
}
