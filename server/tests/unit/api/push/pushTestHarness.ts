import { beforeAll, beforeEach, vi } from 'vitest';
import express, { Express, Request, Response, NextFunction } from 'express';
import { createHmac, createHash } from 'crypto';

vi.mock('../../../../src/config', () => ({
  default: {
    gatewaySecret: 'test-gateway-secret',
  },
}));

vi.mock('../../../../src/repositories', () => ({
  pushDeviceRepository: {
    upsert: vi.fn(),
    findByToken: vi.fn(),
    findByUserId: vi.fn(),
    findById: vi.fn(),
    deleteByToken: vi.fn(),
    deleteById: vi.fn(),
  },
  auditLogRepository: {
    create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
  },
}));

vi.mock('../../../../src/middleware/auth', () => ({
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const userId = (req.headers['x-test-user-id'] as string) || 'test-user-123';
      req.user = { userId, username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
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

vi.mock('../../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

import pushRouter from '../../../../src/api/push';
import { errorHandler } from '../../../../src/errors/errorHandler';
import { pushDeviceRepository, auditLogRepository } from '../../../../src/repositories';

export const mockUpsert = pushDeviceRepository.upsert as ReturnType<typeof vi.fn>;
export const mockFindByToken = pushDeviceRepository.findByToken as ReturnType<typeof vi.fn>;
export const mockFindByUserId = pushDeviceRepository.findByUserId as ReturnType<typeof vi.fn>;
export const mockFindById = pushDeviceRepository.findById as ReturnType<typeof vi.fn>;
export const mockDeleteByToken = pushDeviceRepository.deleteByToken as ReturnType<typeof vi.fn>;
export const mockDeleteById = pushDeviceRepository.deleteById as ReturnType<typeof vi.fn>;
export const mockAuditLogCreate = auditLogRepository.create as ReturnType<typeof vi.fn>;

export function generateGatewaySignature(
  method: string,
  path: string,
  body: unknown,
  secret: string
): { signature: string; timestamp: string } {
  const timestamp = Date.now().toString();

  let bodyHash = '';
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    bodyHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  const message = `${method.toUpperCase()}${path}${timestamp}${bodyHash}`;
  const signature = createHmac('sha256', secret).update(message).digest('hex');

  return { signature, timestamp };
}

export let app: Express;

export const validAndroidToken = 'a'.repeat(150);
export const validIosToken = 'a'.repeat(64);

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
    const normalizedUrl = this.url.replace(/^\/api\/v1\/push/, '') || '/';
    const [pathOnly] = normalizedUrl.split('?');
    const headers = Object.fromEntries(
      Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value])
    );

    return new Promise<HandlerResponse>((resolve, reject) => {
      const req: any = {
        method: this.method,
        url: normalizedUrl,
        originalUrl: this.url,
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

      pushRouter.handle(req, res, (err?: any) => {
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
        reject(new Error(`Route not handled: ${this.method} ${normalizedUrl}`));
      });
    });
  }
}

export const request = (_app: unknown) => ({
  get: (url: string) => new RequestBuilder('GET', url),
  post: (url: string) => new RequestBuilder('POST', url),
  delete: (url: string) => new RequestBuilder('DELETE', url),
});

export function registerPushRoutesTestHarness() {
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/push', pushRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });
}
