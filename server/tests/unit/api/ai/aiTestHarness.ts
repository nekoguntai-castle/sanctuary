import { beforeAll, beforeEach, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import { errorHandler } from '../../../../src/errors/errorHandler';

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (req: Request, res: Response, next: NextFunction) => next(),
}));

vi.mock('../../../../src/services/aiService', () => ({
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

vi.mock('../../../../src/utils/docker', () => ({
  isDockerProxyAvailable: vi.fn(),
  getOllamaStatus: vi.fn(),
  startOllama: vi.fn(),
  stopOllama: vi.fn(),
}));

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

vi.mock('os', () => ({
  totalmem: vi.fn().mockReturnValue(16 * 1024 * 1024 * 1024),
  freemem: vi.fn().mockReturnValue(8 * 1024 * 1024 * 1024),
}));

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
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

import aiRouter from '../../../../src/api/ai';

export let app: Express;

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
      normalizedUrl = '/' + normalizedUrl;
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

      aiRouter.handle(req, res, (err?: any) => {
        if (err) {
          const statusCode = err.statusCode || 500;
          const body = err.toResponse
            ? err.toResponse()
            : { error: 'Internal', code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
          res.statusCode = statusCode;
          res.body = body;
          resolve({ status: statusCode, headers: res.headers, body });
          return;
        }
        reject(new Error('Route not handled: ' + this.method + ' ' + normalizedUrl));
      });
    });
  }
}

export const request = (_app: unknown) => ({
  get: (url: string) => new RequestBuilder('GET', url),
  post: (url: string) => new RequestBuilder('POST', url),
  delete: (url: string) => new RequestBuilder('DELETE', url),
});

export function getMockExecFilePromisified() {
  return mockExecFilePromisified;
}

export function registerAiApiTestHarness() {
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/ai', aiRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
}
