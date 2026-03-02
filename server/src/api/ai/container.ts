/**
 * Ollama Container Management Routes
 *
 * GET /ai/ollama-container/status - Get container status
 * POST /ai/ollama-container/start - Start container
 * POST /ai/ollama-container/stop - Stop container
 *
 * Uses Docker socket proxy for security (only allows container start/stop).
 */

import { Router, Request, Response } from 'express';
import { authenticate } from '../../middleware/auth';
import * as docker from '../../utils/docker';
import { createLogger } from '../../utils/logger';

const log = createLogger('AI-API');

export function createContainerRouter(): Router {
  const router = Router();

  /**
   * GET /api/v1/ai/ollama-container/status
   * Get the status of the bundled Ollama container
   */
  router.get('/ollama-container/status', authenticate, async (req: Request, res: Response) => {
    try {
      const proxyAvailable = await docker.isDockerProxyAvailable();

      if (!proxyAvailable) {
        return res.json({
          available: false,
          exists: false,
          running: false,
          message: 'Docker management not available',
        });
      }

      const status = await docker.getOllamaStatus();

      res.json({
        available: true,
        ...status,
      });
    } catch (error) {
      log.error('Get Ollama container status failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get Ollama container status',
      });
    }
  });

  /**
   * POST /api/v1/ai/ollama-container/start
   * Start the bundled Ollama container
   */
  router.post('/ollama-container/start', authenticate, async (req: Request, res: Response) => {
    try {
      const result = await docker.startOllama();

      if (!result.success) {
        return res.status(400).json({
          error: 'Failed to start',
          message: result.message,
        });
      }

      res.json(result);
    } catch (error) {
      log.error('Start Ollama container failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to start Ollama container',
      });
    }
  });

  /**
   * POST /api/v1/ai/ollama-container/stop
   * Stop the bundled Ollama container
   */
  router.post('/ollama-container/stop', authenticate, async (req: Request, res: Response) => {
    try {
      const result = await docker.stopOllama();

      if (!result.success) {
        return res.status(400).json({
          error: 'Failed to stop',
          message: result.message,
        });
      }

      res.json(result);
    } catch (error) {
      log.error('Stop Ollama container failed', { error: String(error) });
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to stop Ollama container',
      });
    }
  });

  return router;
}
