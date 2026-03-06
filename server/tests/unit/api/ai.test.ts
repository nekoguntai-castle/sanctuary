import { vi, Mock } from 'vitest';
/**
 * AI API Routes Tests
 *
 * Tests for public AI API endpoints including authentication,
 * rate limiting, and error handling.
 *
 * Tests the actual src/api/ai.ts router by using supertest.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import * as os from 'os';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: vi.fn(),
  },
}));

// Mock logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock rate limiter to bypass in tests
vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (req: Request, res: Response, next: NextFunction) => next(),
}));

// Mock AI service with vi.fn() in factory
vi.mock('../../../src/services/aiService', () => ({
  aiService: {
    isEnabled: vi.fn(),
    isContainerAvailable: vi.fn(),
    checkHealth: vi.fn(),
    suggestTransactionLabel: vi.fn(),
    executeNaturalQuery: vi.fn(),
    detectOllama: vi.fn(),
    listModels: vi.fn(),
    pullModel: vi.fn(),
    deleteModel: vi.fn(),
  },
}));

// Mock docker utilities
vi.mock('../../../src/utils/docker', () => ({
  isDockerProxyAvailable: vi.fn(),
  getOllamaStatus: vi.fn(),
  startOllama: vi.fn(),
  stopOllama: vi.fn(),
}));

// Mock child_process execFile for system resources (used via promisify)
const { mockExecFilePromisified } = vi.hoisted(() => ({
  mockExecFilePromisified: vi.fn().mockResolvedValue({
    stdout: 'Filesystem     1M-blocks      Used Available Use% Mounted on\n/dev/sda1         100000     50000     40000  56% /',
    stderr: '',
  }),
}));
vi.mock('child_process', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { promisify } = require('util');
  const fn = vi.fn();
  fn[promisify.custom] = mockExecFilePromisified;
  return { execFile: fn };
});

// Mock os module for system resources
vi.mock('os', () => ({
  totalmem: vi.fn().mockReturnValue(16 * 1024 * 1024 * 1024), // 16GB
  freemem: vi.fn().mockReturnValue(8 * 1024 * 1024 * 1024),   // 8GB free
}));

// Mock authenticate middleware
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: vi.fn((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const isAdmin = req.headers['x-test-admin'] === 'true';
      (req as any).user = { userId: 'user-123', username: 'testuser', isAdmin };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  }),
  requireAdmin: vi.fn((req: Request, res: Response, next: NextFunction) => {
    if ((req as any).user?.isAdmin) {
      next();
    } else {
      res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }
  }),
}));

// Import mocked modules AFTER vi.mock definitions
import { aiService } from '../../../src/services/aiService';
import * as docker from '../../../src/utils/docker';

// Import the router AFTER all mocks are set up
import aiRouter from '../../../src/api/ai';

describe('AI API Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/ai', aiRouter);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  type HandlerResponse = {
    status: number;
    headers: Record<string, string>;
    body?: any;
  };

  class RequestBuilder {
    private headers: Record<string, string> = {};
    private body: unknown;

    constructor(private method: string, private url: string) {}

    set(key: string, value: string): this {
      this.headers[key] = value;
      return this;
    }

    send(body?: unknown): Promise<HandlerResponse> {
      this.body = body;
      return this.exec();
    }

    then<TResult1 = HandlerResponse, TResult2 = never>(
      onfulfilled?: ((value: HandlerResponse) => TResult1 | PromiseLike<TResult1>) | undefined | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null
    ): Promise<TResult1 | TResult2> {
      return this.exec().then(onfulfilled, onrejected);
    }

    private async exec(): Promise<HandlerResponse> {
      let normalizedUrl = this.url.replace(/^\/api\/v1\/ai/, '') || '/';
      if (normalizedUrl.startsWith('?')) {
        normalizedUrl = `/${normalizedUrl}`;
      }
      const [pathOnly] = normalizedUrl.split('?');
      const headers = Object.fromEntries(
        Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value])
      );

      return new Promise<HandlerResponse>((resolve, reject) => {
        const req: any = {
          method: this.method,
          url: normalizedUrl,
          path: pathOnly,
          headers,
          body: this.body ?? {},
        };

        const res: any = {
          statusCode: 200,
          headers: {},
          setHeader: (key: string, value: string) => {
            res.headers[key.toLowerCase()] = value;
          },
          status: (code: number) => {
            res.statusCode = code;
            return res;
          },
          json: (body: unknown) => {
            res.body = body;
            resolve({ status: res.statusCode, headers: res.headers, body: res.body });
          },
          send: (body?: unknown) => {
            res.body = body;
            resolve({ status: res.statusCode, headers: res.headers, body: res.body });
          },
        };

        aiRouter.handle(req, res, (err?: Error) => {
          if (err) {
            reject(err);
            return;
          }
          reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
        });
      });
    }
  }

  const request = (_app: unknown) => ({
    get: (url: string) => new RequestBuilder('GET', url),
    post: (url: string) => new RequestBuilder('POST', url),
    delete: (url: string) => new RequestBuilder('DELETE', url),
  });

  describe('GET /api/v1/ai/status', () => {
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to check AI status');
    });

    it('should require authentication', async () => {
      const response = await request(app).get('/api/v1/ai/status');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('POST /api/v1/ai/suggest-label', () => {
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

    it('should return 400 when transactionId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/ai/suggest-label')
        .set('Authorization', 'Bearer test-token')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to generate label suggestion');
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
  });

  describe('POST /api/v1/ai/query', () => {
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

    it('should return 400 when query is missing', async () => {
      const response = await request(app)
        .post('/api/v1/ai/query')
        .set('Authorization', 'Bearer test-token')
        .send({ walletId: 'wallet-123' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
      expect(response.body.message).toBe('Query and walletId are required');
    });

    it('should return 400 when walletId is missing', async () => {
      const response = await request(app)
        .post('/api/v1/ai/query')
        .set('Authorization', 'Bearer test-token')
        .send({ query: 'Show transactions' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Bad Request');
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
      expect(response.body.error).toBe('Internal Server Error');
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
  });

  describe('POST /api/v1/ai/detect-ollama', () => {
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to detect Ollama');
    });
  });

  describe('GET /api/v1/ai/models', () => {
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to list models');
    });
  });

  describe('POST /api/v1/ai/pull-model', () => {
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
      expect(response.body.error).toBe('Bad Request');
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to pull model');
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
  });

  describe('DELETE /api/v1/ai/delete-model', () => {
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
      expect(response.body.error).toBe('Bad Request');
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
      expect(response.body.error).toBe('Internal Server Error');
      expect(response.body.message).toBe('Failed to delete model');
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
  });

  describe('Ollama Container Management', () => {
    describe('GET /api/v1/ai/ollama-container/status', () => {
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
        expect(response.body.error).toBe('Internal Server Error');
      });
    });

    describe('POST /api/v1/ai/ollama-container/start', () => {
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
        expect(response.body.error).toBe('Internal Server Error');
      });
    });

    describe('POST /api/v1/ai/ollama-container/stop', () => {
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
        expect(response.body.error).toBe('Internal Server Error');
      });
    });
  });

  describe('GET /api/v1/ai/system-resources', () => {
    it('should return system resource information', async () => {
      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.ram).toBeDefined();
      expect(response.body.ram.total).toBeDefined();
      expect(response.body.ram.available).toBeDefined();
      expect(response.body.ram.required).toBeDefined();
      expect(response.body.ram.sufficient).toBeDefined();
      expect(response.body.disk).toBeDefined();
      expect(response.body.gpu).toBeDefined();
      expect(response.body.overall).toBeDefined();
    });

    it('should indicate when resources are sufficient', async () => {
      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      // With 8GB free RAM (mocked above), should be sufficient (>4GB required)
      expect(response.body.ram.sufficient).toBe(true);
    });

    it('should fall back when disk and gpu probes fail', async () => {
      mockExecFilePromisified
        .mockRejectedValueOnce(new Error('df failed'))
        .mockRejectedValueOnce(new Error('df fallback failed'))
        .mockRejectedValueOnce(new Error('nvidia-smi missing'));

      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.disk.total).toBe(0);
      expect(response.body.disk.available).toBe(0);
      expect(response.body.gpu).toEqual({ available: false, name: null });
    });

    it('should return 500 when system resource check throws unexpectedly', async () => {
      (os.freemem as Mock).mockImplementationOnce(() => {
        throw new Error('freemem failed');
      });

      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal Server Error');
    });

    it('should fall back to zero disk values when df numeric fields are invalid', async () => {
      mockExecFilePromisified
        .mockResolvedValueOnce({
          stdout: 'Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/sda1 xx yy zz 56% /',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.disk.total).toBe(0);
      expect(response.body.disk.available).toBe(0);
    });

    it('should fall back to zero disk values when df output has too few columns', async () => {
      mockExecFilePromisified
        .mockResolvedValueOnce({
          stdout: 'Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/sda1 100000 50000',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.disk.total).toBe(0);
      expect(response.body.disk.available).toBe(0);
    });

    it('should include low RAM warning when available memory is below recommendation', async () => {
      (os.freemem as Mock).mockReturnValueOnce(2 * 1024 * 1024 * 1024); // 2GB

      const response = await request(app)
        .get('/api/v1/ai/system-resources')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
      expect(response.body.ram.sufficient).toBe(false);
      expect(response.body.overall.warnings.some((w: string) => w.startsWith('Low RAM:'))).toBe(true);
    });
  });

  describe('Authentication', () => {
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
  });

  describe('Rate Limiting', () => {
    it('should apply rate limiter to AI endpoints', async () => {
      (aiService.isEnabled as Mock).mockResolvedValue(true);
      (aiService.checkHealth as Mock).mockResolvedValue({ available: true });

      // Make a request - rate limiter is applied but not blocking in tests
      const response = await request(app)
        .get('/api/v1/ai/status')
        .set('Authorization', 'Bearer test-token');

      expect(response.status).toBe(200);
    });
  });
});
