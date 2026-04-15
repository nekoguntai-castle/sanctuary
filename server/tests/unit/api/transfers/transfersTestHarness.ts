import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeAll, beforeEach, vi } from 'vitest';

const transferMocks = vi.hoisted(() => ({
  mockInitiateTransfer: vi.fn(),
  mockAcceptTransfer: vi.fn(),
  mockDeclineTransfer: vi.fn(),
  mockCancelTransfer: vi.fn(),
  mockConfirmTransfer: vi.fn(),
  mockGetUserTransfers: vi.fn(),
  mockGetTransfer: vi.fn(),
  mockGetPendingIncomingCount: vi.fn(),
  mockGetAwaitingConfirmationCount: vi.fn(),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/services/transferService', () => ({
  initiateTransfer: transferMocks.mockInitiateTransfer,
  acceptTransfer: transferMocks.mockAcceptTransfer,
  declineTransfer: transferMocks.mockDeclineTransfer,
  cancelTransfer: transferMocks.mockCancelTransfer,
  confirmTransfer: transferMocks.mockConfirmTransfer,
  getUserTransfers: transferMocks.mockGetUserTransfers,
  getTransfer: transferMocks.mockGetTransfer,
  getPendingIncomingCount: transferMocks.mockGetPendingIncomingCount,
  getAwaitingConfirmationCount: transferMocks.mockGetAwaitingConfirmationCount,
}));

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      const userId = req.headers['x-test-user-id'] as string || 'test-user-123';
      req.user = { userId, username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
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

type HandlerResponse = {
  status: number;
  headers: Record<string, string>;
  body?: any;
};

let app: Express;
let transfersRouter: { handle: (req: unknown, res: unknown, next: (err?: unknown) => void) => void };

export const authHeader = 'Bearer valid-token';
export const userId = 'user-123';
export const recipientId = 'recipient-456';
export const walletId = 'wallet-789';
export const transferId = 'transfer-xyz';

export const mockInitiateTransfer = transferMocks.mockInitiateTransfer;
export const mockAcceptTransfer = transferMocks.mockAcceptTransfer;
export const mockDeclineTransfer = transferMocks.mockDeclineTransfer;
export const mockCancelTransfer = transferMocks.mockCancelTransfer;
export const mockConfirmTransfer = transferMocks.mockConfirmTransfer;
export const mockGetUserTransfers = transferMocks.mockGetUserTransfers;
export const mockGetTransfer = transferMocks.mockGetTransfer;
export const mockGetPendingIncomingCount = transferMocks.mockGetPendingIncomingCount;
export const mockGetAwaitingConfirmationCount = transferMocks.mockGetAwaitingConfirmationCount;

export function setupTransfersApiTestHarness(): void {
  beforeAll(async () => {
    const [routerModule, errorsModule] = await Promise.all([
      import('../../../../src/api/transfers'),
      import('../../../../src/errors/errorHandler'),
    ]);

    transfersRouter = routerModule.default;
    app = express();
    app.use(express.json());
    app.use('/api/v1/transfers', transfersRouter as any);
    app.use(errorsModule.errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}

export function getTransfersApp(): Express {
  return app;
}

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
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    return this.exec().then(onfulfilled, onrejected);
  }

  private async exec(): Promise<HandlerResponse> {
    let normalizedUrl = this.url.replace(/^\/api\/v1\/transfers/, '') || '/';
    if (normalizedUrl.startsWith('?')) {
      normalizedUrl = `/${normalizedUrl}`;
    }
    const [pathOnly, queryString] = normalizedUrl.split('?');
    const headers = Object.fromEntries(
      Object.entries(this.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );
    const query = queryString ? Object.fromEntries(new URLSearchParams(queryString)) : {};

    return new Promise<HandlerResponse>((resolve, reject) => {
      const req: any = {
        method: this.method,
        url: normalizedUrl,
        path: pathOnly,
        headers,
        body: this.body ?? {},
        query,
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

      transfersRouter.handle(req, res, (err?: any) => {
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
});
