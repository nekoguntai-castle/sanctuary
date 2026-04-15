import { describe, expect, it } from 'vitest';

import {
  aiInternalRequest,
  internalIp,
  mockNotificationService,
} from './aiInternalTestHarness';

export function registerAiInternalPullProgressContracts(): void {
  describe('POST /internal/ai/pull-progress', () => {
    it('should broadcast progress updates', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2:7b',
          status: 'downloading',
          completed: 500,
          total: 1000,
          digest: 'sha256:abc123',
        });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith({
        model: 'llama2:7b',
        status: 'downloading',
        completed: 500,
        total: 1000,
        percent: 50,
        digest: 'sha256:abc123',
        error: undefined,
      });
    });

    it('should return 400 when model is missing', async () => {
      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({ status: 'downloading' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model and status required');
    });

    it('should return 400 when status is missing', async () => {
      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({ model: 'llama2' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('model and status required');
    });

    it('should handle zero total (calculate percent as 0)', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'preparing',
          completed: 0,
          total: 0,
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({ percent: 0 })
      );
    });

    it('should handle missing completed/total fields', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'complete',
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          completed: 0,
          total: 0,
          percent: 0,
        })
      );
    });

    it('should broadcast error status', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'error',
          error: 'Download failed',
        });

      expect(res.status).toBe(200);
      expect(mockNotificationService.broadcastModelDownloadProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: 'Download failed',
        })
      );
    });

    it('should return 500 on internal error', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockImplementation(() => {
        throw new Error('Broadcast failed');
      });

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'downloading',
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal error');
    });

    it('should NOT require authentication (no JWT)', async () => {
      mockNotificationService.broadcastModelDownloadProgress.mockReturnValue(undefined);

      const res = await aiInternalRequest()
        .post('/internal/ai/pull-progress')
        .set('X-Forwarded-For', internalIp)
        .send({
          model: 'llama2',
          status: 'downloading',
        });

      expect(res.status).toBe(200);
    });
  });
}
